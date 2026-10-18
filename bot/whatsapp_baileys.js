/**
 * bot/whatsapp_baileys.js
 * Unofficial WhatsApp Web adapter for a PERSONAL PROTOTYPE ONLY.
 *
 * Read this before enabling it:
 *  - Baileys is an unofficial, reverse-engineered client. It is not sanctioned by
 *    WhatsApp, accounts can be restricted, and its own docs say the multi-file auth
 *    helper is not meant for production.
 *  - The auth folder is equivalent to a logged-in session. It is git-ignored and must
 *    never be committed or shared.
 *  - Use a dedicated number, or self-chat only. Never point this at the public.
 *  - For anything public, use the official Cloud API adapter instead.
 *
 * Hardening (F-15 / D.4):
 *  - allow-list of consented JIDs, or self-chat only;
 *  - skips group (@g.us) and status@broadcast traffic entirely;
 *  - processes every message in the event, not just messages[0];
 *  - ignores history-sync events (type !== 'notify');
 *  - one socket, listeners removed before reconnect, exponential back-off;
 *  - message ids deduped so a reconnect cannot double-process;
 *  - no message bodies in logs.
 */

import { Channel } from './channel.js';

const MAX_BACKOFF_MS = 30_000;
const SEEN_LIMIT = 500;

/** Accepts a comma-separated string or an array, and drops empty entries. */
function toList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Turn a Baileys disconnect code into something an operator can act on.
 *
 * Silence here is what made "the QR never appeared" impossible to diagnose: the adapter
 * used to swallow every close reason and just retry in the background.
 */
export function describeDisconnect(code) {
  switch (code) {
    case 401:
      return {
        message: 'you were logged out (401).',
        advice: 'Re-link the device: npm run bot:logout, then npm run bot:whatsapp and scan again.',
        fatal: true,
      };
    case 403:
      return { message: 'WhatsApp refused the connection (403).', advice: 'This number may be restricted.', fatal: true };
    case 411:
      return { message: 'multi-device mismatch (411).', advice: 'Run npm run bot:logout and pair again.', fatal: true };
    case 440:
      return {
        message: 'another session took over this account (440).',
        advice: 'Only one bot instance can run per number. Close the other one, or run npm run bot:logout and re-link.',
        fatal: true,
      };
    case 500:
      return { message: 'the stored session is no longer valid (500).', advice: 'Run npm run bot:logout and pair again.', fatal: true };
    case 515:
      return { message: 'WhatsApp asked for a restart (515).', advice: 'Normal straight after pairing - reconnecting now.', fatal: false };
    case 428:
      return { message: 'the connection closed (428).', advice: null, fatal: false };
    case 408:
      return { message: 'the connection timed out (408).', advice: 'Check your internet connection.', fatal: false };
    case 503:
      return { message: 'WhatsApp is temporarily unavailable (503).', advice: 'Waiting and retrying.', fatal: false };
    default:
      return {
        message: code === undefined ? 'the connection closed without a reason code.' : `the connection closed (code ${code}).`,
        advice: null,
        fatal: false,
      };
  }
}

export class BaileysChannel extends Channel {
  constructor({ router, config = {} }) {
    super('whatsapp-baileys');
    const env = config.env || process.env;

    this.router = router;
    this.config = config;
    this.env = env;
    this.authDir = config.authDir || env.BAILEYS_AUTH_DIR || 'auth_info_baileys';
    this.selfChatOnly = (config.selfChatOnly ?? env.SELF_CHAT_ONLY === 'true') === true;
    this.allowed = new Set(toList(config.allowedJids ?? env.ALLOWED_JIDS));
    this.sock = null;
    this.retry = 0;
    this.seen = new Set();
    this.stopping = false;
    this.ownJid = null;
    this.halfPaired = false;
  }

  /** Operator-facing status. Goes to stderr so it never corrupts a piped QR. */
  log(message) {
    process.stderr.write(`${message}\n`);
  }

  /** Static guard so callers can refuse to boot an unsafe configuration. */
  static assertSafeConfig(env = process.env) {
    const selfChat = env.SELF_CHAT_ONLY === 'true';
    const allowList = toList(env.ALLOWED_JIDS);
    if (!selfChat && allowList.length === 0) {
      throw new Error(
        'Refusing to start the Baileys prototype without SELF_CHAT_ONLY=true or a non-empty ALLOWED_JIDS allow-list. ' +
          'This adapter is not safe to expose to the public - use the official Cloud API adapter for that.',
      );
    }
    return true;
  }

  async start() {
    BaileysChannel.assertSafeConfig(this.env);
    const baileys = await import('@whiskeysockets/baileys').catch(() => {
      throw new Error(
        'The Baileys prototype adapter needs the optional dependency @whiskeysockets/baileys. Install it with: npm install @whiskeysockets/baileys',
      );
    });
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;
    const pino = (await import('pino')).default;
    this.DisconnectReason = DisconnectReason;

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    // A half-finished pairing is the classic "no QR appears" trap: the creds exist, so
    // Baileys tries to log in with them instead of showing a code, and the login cannot
    // succeed. Say so out loud rather than sitting there silently.
    const creds = state.creds ?? {};
    this.halfPaired = Boolean(creds.me && !creds.registered);
    if (this.halfPaired) {
      this.log('A previous pairing attempt did not finish (credentials exist but are not registered).');
      this.log('If no QR appears within a few seconds, run: npm run bot:logout');
    }

    // Never keep two handler sets alive across reconnects.
    if (this.sock) this.sock.ev.removeAllListeners();
    this.sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }) });

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.log('Scan this QR code: WhatsApp > Settings > Linked devices > Link a device.');
        try {
          const qrcode = (await import('qrcode-terminal')).default;
          qrcode.generate(qr, { small: true });
        } catch {
          this.log('A QR code is ready, but qrcode-terminal is not installed. Run: npm install qrcode-terminal');
        }
      }

      if (connection === 'connecting') {
        this.log('Connecting to WhatsApp...');
      }

      if (connection === 'open') {
        this.retry = 0;
        this.halfPaired = false;
        this.ownJid = this.sock?.user?.id || null;
        this.log(`Connected as ${this.ownJid ?? 'unknown'}.`);
        if (this.selfChatOnly) {
          this.log('Self-chat mode: open the chat with yourself in WhatsApp and send HELP.');
        } else if (this.allowed.size) {
          this.log(`Allow-list mode: answering ${this.allowed.size} number(s).`);
        }
      }

      if (connection === 'close' && !this.stopping) {
        const code = lastDisconnect?.error?.output?.statusCode;
        const verdict = describeDisconnect(code);
        this.log(`Connection closed: ${verdict.message}`);
        if (verdict.advice) this.log(verdict.advice);

        if (verdict.fatal) {
          this.log('Not retrying. Fix the above, then start again.');
          return;
        }
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retry++);
        this.log(`Reconnecting in ${Math.round(delay / 1000)}s...`);
        setTimeout(() => this.start().catch((err) => this.log(`Reconnect failed: ${err.message}`)), delay);
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('messages.upsert', (event) => this.onUpsert(event));
  }

  /** Remember a message id so it is never processed twice. */
  remember(id) {
    if (!id) return false;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > SEEN_LIMIT) {
      this.seen = new Set([...this.seen].slice(-Math.floor(SEEN_LIMIT / 2)));
    }
    return true;
  }

  /** Handles an upsert event. Exposed for tests (no socket needed). */
  async onUpsert({ messages, type } = {}) {
    if (type !== 'notify') return; // skip history sync and other event types

    for (const msg of messages || []) {
      const jid = msg?.key?.remoteJid;
      if (!jid) continue;
      if (!msg.message) continue;
      if (jid.endsWith('@g.us')) continue; // groups
      if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue; // status

      const fromMe = Boolean(msg.key?.fromMe);
      // Self-chat mode: only the owner's own messages in the "message yourself" chat.
      if (this.selfChatOnly && !fromMe) continue;
      // Allow-list mode: only consented users.
      if (!this.selfChatOnly && this.allowed.size && !this.allowed.has(jid)) continue;

      // De-duplicate. This also drops the bot's OWN replies: in self-chat mode they are
      // fromMe too, so without recording outgoing ids the bot would answer itself forever.
      if (!this.remember(msg.key?.id)) continue;

      const text = extractText(msg);
      if (!text) continue;

      const { replies } = this.router.handle(jid, text);
      for (const reply of replies) await this.send(jid, reply);
    }
  }

  async send(rawId, text) {
    if (!this.sock) return undefined;
    const sent = await this.sock.sendMessage(rawId, { text });
    // Record our own outgoing id so self-chat mode cannot reply to itself.
    this.remember(sent?.key?.id);
    return sent;
  }

  async stop() {
    this.stopping = true;
    try {
      this.sock?.ev?.removeAllListeners();
      this.sock?.end?.(undefined);
    } finally {
      this.sock = null;
    }
  }
}

/** Pull text out of the message shapes WhatsApp actually sends. */
export function extractText(msg) {
  const m = msg?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

export default { BaileysChannel, extractText };
