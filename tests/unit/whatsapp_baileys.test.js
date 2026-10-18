import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../store/db.js';
import { createRouter } from '../../bot/router.js';
import { BaileysChannel, extractText, describeDisconnect } from '../../bot/whatsapp_baileys.js';
import { main } from '../../bot/index.js';

/**
 * The WhatsApp transport layer.
 *
 * `onUpsert` decides what the bot ever sees in a real chat, so it is tested without a
 * socket: a fake sock records what the bot tries to send. This covers the traffic that
 * would otherwise be discovered the hard way - group chatter, status updates, history
 * replay, and the bot answering its own replies in self-chat mode.
 */

const OWNER = '919812345678@s.whatsapp.net';
const OTHER = '919800000000@s.whatsapp.net';

let store;
let router;

beforeEach(() => {
  store = openDatabase({ path: ':memory:', secret: 'baileys-test-secret-1234567890' });
  router = createRouter({ store, config: { retentionDays: 90 } });
});

/** Build a channel with a fake socket that records every outbound message. */
function makeChannel(config = {}) {
  const channel = new BaileysChannel({ router, config: { selfChatOnly: true, ...config } });
  const sent = [];
  channel.sock = {
    sendMessage: async (jid, payload) => {
      const id = `out-${sent.length + 1}`;
      sent.push({ jid, text: payload.text, id });
      return { key: { id, remoteJid: jid, fromMe: true } };
    },
  };
  channel.sent = sent;
  return channel;
}

/** An inbound text message, shaped the way Baileys delivers it. */
function inbound(text, { jid = OWNER, fromMe = false, id = `in-${Math.random().toString(36).slice(2, 9)}` } = {}) {
  return { key: { remoteJid: jid, fromMe, id }, message: { conversation: text } };
}

const notify = (...messages) => ({ messages, type: 'notify' });

describe('extractText', () => {
  it('reads every message shape WhatsApp actually sends', () => {
    expect(extractText({ message: { conversation: 'hi' } })).toBe('hi');
    expect(extractText({ message: { extendedTextMessage: { text: 'hi' } } })).toBe('hi');
    expect(extractText({ message: { imageMessage: { caption: 'receipt 500' } } })).toBe('receipt 500');
    expect(extractText({ message: { buttonsResponseMessage: { selectedButtonId: 'YES' } } })).toBe('YES');
    expect(extractText({ message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'AUDIT' } } } })).toBe('AUDIT');
  });

  it('returns an empty string for a message with no text', () => {
    expect(extractText({ message: {} })).toBe('');
    expect(extractText({})).toBe('');
    expect(extractText(null)).toBe('');
  });
});

describe('what the bot refuses to see', () => {
  it('ignores group chatter', async () => {
    const channel = makeChannel();
    await channel.onUpsert(notify(inbound('medicine 400', { jid: '12345@g.us', fromMe: true })));
    expect(channel.sent).toHaveLength(0);
  });

  it('ignores status broadcasts', async () => {
    const channel = makeChannel();
    await channel.onUpsert(notify(inbound('medicine 400', { jid: 'status@broadcast', fromMe: true })));
    expect(channel.sent).toHaveLength(0);
  });

  it('ignores history replay (a non-notify event)', async () => {
    const channel = makeChannel();
    await channel.onUpsert({ messages: [inbound('AGREE', { fromMe: true })], type: 'append' });
    expect(channel.sent).toHaveLength(0);
  });

  it('ignores messages with no text and messages with no sender', async () => {
    const channel = makeChannel();
    await channel.onUpsert(notify({ key: { remoteJid: OWNER, fromMe: true, id: 'x1' }, message: {} }, { key: { fromMe: true, id: 'x2' }, message: { conversation: 'hi' } }));
    expect(channel.sent).toHaveLength(0);
  });
});

describe('self-chat mode', () => {
  it('answers the owner in the "message yourself" chat', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    await channel.onUpsert(notify(inbound('HELP', { fromMe: true })));
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0].jid).toBe(OWNER);
    expect(channel.sent[0].text).toContain('COMMANDS');
  });

  it('ignores other people entirely', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    await channel.onUpsert(notify(inbound('HELP', { jid: OTHER, fromMe: false })));
    expect(channel.sent).toHaveLength(0);
  });

  it('does NOT answer its own reply (no self-chat loop)', async () => {
    const channel = makeChannel({ selfChatOnly: true });

    // 1. The owner sends HELP; the bot replies.
    await channel.onUpsert(notify(inbound('HELP', { fromMe: true, id: 'in-1' })));
    expect(channel.sent).toHaveLength(1);
    const reply = channel.sent[0];

    // 2. WhatsApp delivers the bot's own reply back as an upsert. It is fromMe, in the
    //    same chat, so without outgoing-id tracking the bot would answer itself forever.
    await channel.onUpsert(notify({
      key: { remoteJid: OWNER, fromMe: true, id: reply.id },
      message: { conversation: reply.text },
    }));

    expect(channel.sent).toHaveLength(1); // still just the one reply
  });

  it('does not loop even when the reply looks like a command', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    await channel.onUpsert(notify(inbound('HELP', { fromMe: true, id: 'in-2' })));
    const first = channel.sent[0];

    // Feed the bot's own output back in three times, as a loop would.
    for (let i = 0; i < 3; i++) {
      await channel.onUpsert(notify({
        key: { remoteJid: OWNER, fromMe: true, id: first.id },
        message: { conversation: first.text },
      }));
    }
    expect(channel.sent).toHaveLength(1);
  });
});

describe('allow-list mode', () => {
  it('answers only the consented JIDs', async () => {
    const channel = makeChannel({ selfChatOnly: false, allowedJids: [OWNER] });
    await channel.onUpsert(notify(inbound('HELP', { jid: OWNER, fromMe: false })));
    expect(channel.sent).toHaveLength(1);

    await channel.onUpsert(notify(inbound('HELP', { jid: OTHER, fromMe: false })));
    expect(channel.sent).toHaveLength(1); // unchanged
  });

  it('accepts a comma-separated list from the environment', () => {
    const channel = new BaileysChannel({
      router,
      config: { selfChatOnly: false, env: { ALLOWED_JIDS: `${OWNER}, ${OTHER}` } },
    });
    expect(channel.allowed.has(OWNER)).toBe(true);
    expect(channel.allowed.has(OTHER)).toBe(true);
  });
});

describe('message handling', () => {
  it('processes every message in the batch, not just the first', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    await channel.onUpsert(notify(
      inbound('AGREE', { fromMe: true, id: 'b1' }),
      inbound('medicine 400', { fromMe: true, id: 'b2' }),
      inbound('electricity 1500', { fromMe: true, id: 'b3' }),
    ));
    const all = channel.sent.map((s) => s.text).join('\n');
    expect(all).toContain('Consent recorded');
    expect(all).toContain('₹400');
    expect(all).toContain('₹1,500');
  });

  it('never processes the same message id twice (a reconnect cannot double-charge a reply)', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    const msg = inbound('AGREE', { fromMe: true, id: 'dup-1' });
    await channel.onUpsert(notify(msg));
    const afterFirst = channel.sent.length;
    await channel.onUpsert(notify(msg));
    expect(channel.sent).toHaveLength(afterFirst);
  });

  it('runs a full audit conversation over the transport', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    const script = [
      'AGREE', 'AUDIT',
      '60000', 'yes', 'skip', '12000', 'yes', '28000', 'yes', '40000', 'yes',
      '1', '2', 'no',
      'HDFC credit card', '1', 'no', '65000', 'yes', '3500', 'yes', '42', '100000', 'yes',
      'done', 'DONE',
    ];
    for (const [i, text] of script.entries()) {
      await channel.onUpsert(notify(inbound(text, { fromMe: true, id: `s-${i}` })));
    }
    const all = channel.sent.map((s) => s.text).join('\n');
    expect(all).toContain('YOUR DEBT REALITY CHECK');
    expect(all).toContain('WHAT I WOULD FOCUS ON NEXT');
    expect(all).toMatch(/Tier \d of 4/);
  });

  it('keeps working when a send fails', async () => {
    const channel = makeChannel({ selfChatOnly: true });
    let calls = 0;
    channel.sock.sendMessage = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network blip');
      return { key: { id: `out-${calls}` } };
    };
    await expect(channel.onUpsert(notify(inbound('HELP', { fromMe: true })))).rejects.toThrow('network blip');
    // The next message still goes through.
    await channel.onUpsert(notify(inbound('HELP', { fromMe: true, id: 'next' })));
    expect(calls).toBeGreaterThan(1);
  });
});

describe('the startup guard', () => {
  it('refuses to start with no self-chat flag and no allow-list', () => {
    expect(() => BaileysChannel.assertSafeConfig({})).toThrow(/Refusing to start/);
  });

  it('starts with self-chat only', () => {
    expect(BaileysChannel.assertSafeConfig({ SELF_CHAT_ONLY: 'true' })).toBe(true);
  });

  it('starts with a non-empty allow-list', () => {
    expect(BaileysChannel.assertSafeConfig({ ALLOWED_JIDS: OWNER })).toBe(true);
  });

  it('refuses an allow-list that is only whitespace', () => {
    expect(() => BaileysChannel.assertSafeConfig({ ALLOWED_JIDS: ' , , ' })).toThrow(/Refusing to start/);
  });
});

/**
 * Silence is what made "the QR never appeared" impossible to diagnose: the adapter used to
 * swallow every close reason and retry in the background with no output at all.
 */
describe('disconnect reasons are explained, not swallowed', () => {
  it('treats a logged-out session as fatal and says how to fix it', () => {
    const v = describeDisconnect(401);
    expect(v.fatal).toBe(true);
    expect(v.message).toMatch(/logged out/i);
    expect(v.advice).toMatch(/bot:logout/);
  });

  it('explains a session taken over by another instance', () => {
    const v = describeDisconnect(440);
    expect(v.fatal).toBe(true);
    expect(v.advice).toMatch(/one bot instance/i);
  });

  it('treats a post-pairing restart as normal, not fatal', () => {
    const v = describeDisconnect(515);
    expect(v.fatal).toBe(false);
    expect(v.message).toMatch(/restart/i);
  });

  it('treats ordinary drops as retryable', () => {
    for (const code of [428, 408, 503, undefined, 999]) {
      const v = describeDisconnect(code);
      expect(v.fatal, String(code)).toBe(false);
      expect(v.message, String(code)).toBeTruthy();
    }
  });

  it('handles a missing reason code without throwing', () => {
    expect(() => describeDisconnect(undefined)).not.toThrow();
    expect(describeDisconnect(undefined).message).toMatch(/without a reason code/);
  });

  it('always gives an actionable message for the fatal cases', () => {
    for (const code of [401, 403, 411, 440, 500]) {
      const v = describeDisconnect(code);
      expect(v.fatal, String(code)).toBe(true);
      expect(v.advice, String(code)).toBeTruthy();
    }
  });
});

describe('npm run bot:logout', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drc-auth-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('clears a half-paired session', async () => {
    writeFileSync(join(dir, 'creds.json'), JSON.stringify({ registered: false, me: { id: OWNER } }));
    writeFileSync(join(dir, 'pre-key-1.json'), '{}');
    expect(existsSync(dir)).toBe(true);

    const result = await main(['--logout', '--auth-dir', dir]);

    expect(result.loggedOut).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('is harmless when there is no session to clear', async () => {
    rmSync(dir, { recursive: true, force: true });
    const result = await main(['--logout', '--auth-dir', dir]);
    expect(result.loggedOut).toBe(true);
  });

  it('does not need the messaging guard, a database or a network', async () => {
    // --logout runs before the safety guard and before the store is opened, so it works
    // even when the session is the thing that is broken.
    writeFileSync(join(dir, 'creds.json'), '{}');
    await expect(main(['--logout', '--auth-dir', dir])).resolves.toEqual({ loggedOut: true });
  });
});
