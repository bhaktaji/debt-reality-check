/**
 * bot/whatsapp_cloud.js
 * Official WhatsApp Cloud API adapter - the PRODUCTION path (F-14, E.2).
 *
 * Requires Meta business verification, a phone number id, a permanent access token,
 * a webhook verification token, and the Meta App Secret for HMAC-SHA256 signature verification.
 *
 * This adapter is deliberately a thin transport: it verifies and converts an inbound
 * webhook payload into (rawId, text), deduplicates via persistent SQLite storage, feeds
 * the shared deterministic router, and posts replies back to the Graph API with bounded
 * exponential backoff. It contains no financial logic and never logs message bodies or secrets.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Channel } from './channel.js';

export const GRAPH_VERSION = 'v21.0';
const DEFAULT_MAX_BODY_BYTES = 256 * 1024; // 256 KB max webhook payload
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const SEEN_MEMORY_LIMIT = 2000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/** Split a long text message into chunks <= maxLen characters on paragraph or line boundaries. */
export function splitWhatsAppMessage(text, maxLen = 3800) {
  const s = String(text ?? '');
  if (s.length <= maxLen) return [s];
  const chunks = [];
  let remaining = s;
  while (remaining.length > maxLen) {
    let idx = remaining.lastIndexOf('\n\n', maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf('\n', maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf(' ', maxLen);
    if (idx <= 0) idx = maxLen;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class CloudApiChannel extends Channel {
  /**
   * @param {{router:object, store?:object, config?:object}} options
   */
  constructor({ router, store, config = {} }) {
    super('whatsapp-cloud');
    const env = config.env || process.env;
    this.router = router;
    this.store = store || router?.store || null;
    this.config = config;
    this.env = env;
    this.phoneNumberId = config.phoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? '';
    this.accessToken = config.accessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? '';
    this.verifyToken = config.verifyToken ?? env.WHATSAPP_VERIFY_TOKEN ?? '';
    this.appSecret = config.appSecret ?? env.WHATSAPP_APP_SECRET ?? '';
    this.graphVersion = config.graphVersion || env.WHATSAPP_GRAPH_API_VERSION || GRAPH_VERSION;
    this.baseUrl = config.baseUrl || env.WHATSAPP_BASE_URL || 'https://graph.facebook.com';
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    this.port = Number(config.port ?? env.PORT ?? 3000);
    this.webhookPath = config.webhookPath || env.WHATSAPP_WEBHOOK_PATH || '/webhook';
    this.maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleepImpl = config.sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.staticDir = config.staticDir ?? resolve('dist/web');
    this.rateLimitPerMin = config.rateLimitPerMin ?? 60;
    this.requireSignature = config.requireSignature ?? (env.NODE_ENV === 'production' || Boolean(this.appSecret));

    this.seenMemory = new Set();
    this.rateBuckets = new Map();
    this.server = null;

    this.metrics = {
      webhooksReceived: 0,
      webhooksVerified: 0,
      webhooksRejected: 0,
      signatureFailures: 0,
      consecutiveWebhookFailures: 0,
      duplicatesDropped: 0,
      messagesProcessed: 0,
      messagesFailed: 0,
      outboundSent: 0,
      outboundFailed: 0,
      outboundRetries: 0,
      statusNotifications: 0,
    };
  }

  get configured() {
    return Boolean(this.phoneNumberId && this.accessToken);
  }

  /**
   * Assert that required production secrets and credentials are configured.
   */
  static assertProductionConfig(env = process.env) {
    const missing = [];
    if (!env.PSEUDONYM_SECRET || String(env.PSEUDONYM_SECRET).length < 16) {
      missing.push('PSEUDONYM_SECRET (at least 16 chars)');
    }
    if (!env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!env.WHATSAPP_VERIFY_TOKEN) missing.push('WHATSAPP_VERIFY_TOKEN');
    if (!env.WHATSAPP_APP_SECRET) missing.push('WHATSAPP_APP_SECRET');
    if (missing.length) {
      throw new Error(
        `Refusing to start WhatsApp Cloud API in production: missing required configuration: ${missing.join(', ')}.`,
      );
    }
    return true;
  }

  /** Structured JSON log without sensitive user payloads or secrets. */
  logEvent(level, event, details = {}) {
    if (this.config?.silentLogs) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      service: 'drc-whatsapp-cloud',
      event,
      ...details,
    };
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(entry)}\n`);
  }

  /** Meta's GET verification handshake. */
  verifyWebhook(query = {}) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (
      mode === 'subscribe' &&
      Boolean(this.verifyToken) &&
      typeof token === 'string' &&
      token.length === this.verifyToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.verifyToken))
    ) {
      this.metrics.webhooksVerified += 1;
      return { ok: true, challenge: String(challenge ?? '') };
    }
    this.metrics.webhooksRejected += 1;
    return { ok: false };
  }

  /**
   * Verify X-Hub-Signature-256 against the raw request body using WHATSAPP_APP_SECRET.
   */
  verifySignature(rawBody, signatureHeader) {
    if (!this.appSecret) {
      return !this.requireSignature;
    }
    if (!signatureHeader || typeof signatureHeader !== 'string') {
      this.metrics.signatureFailures += 1;
      return false;
    }
    const [algo, receivedHex] = signatureHeader.trim().split('=');
    if (algo !== 'sha256' || !receivedHex || !/^[0-9a-f]{64}$/i.test(receivedHex)) {
      this.metrics.signatureFailures += 1;
      return false;
    }
    const expectedHex = createHmac('sha256', this.appSecret)
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8'))
      .digest('hex');

    const a = Buffer.from(receivedHex.toLowerCase(), 'utf8');
    const b = Buffer.from(expectedHex.toLowerCase(), 'utf8');
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) this.metrics.signatureFailures += 1;
    return valid;
  }

  /**
   * Parse an inbound webhook body into messages and status events.
   * Ignores groups and broadcasts. Flags unsupported non-text messages so the bot can reply politely.
   */
  static parseWebhook(body) {
    const out = [];
    if (!body || typeof body !== 'object') return out;

    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value || {};
        for (const msg of Array.isArray(value.messages) ? value.messages : []) {
          if (!msg || typeof msg !== 'object' || !msg.from) continue;
          const from = String(msg.from).trim();
          if (!from || from.endsWith('@g.us') || from.endsWith('@broadcast') || from === 'status@broadcast') {
            continue;
          }
          const type = msg.type || 'text';
          const text = (
            msg.text?.body ??
            msg.button?.text ??
            msg.interactive?.button_reply?.id ??
            msg.interactive?.button_reply?.title ??
            msg.interactive?.list_reply?.id ??
            msg.interactive?.list_reply?.title ??
            ''
          ).trim();

          if (text) {
            out.push({ rawId: from, text, messageId: msg.id || null, type: 'text' });
          } else if (type !== 'reaction' && type !== 'system') {
            out.push({
              rawId: from,
              text: '__UNSUPPORTED_MEDIA__',
              messageId: msg.id || null,
              type: 'unsupported',
              originalType: type,
            });
          }
        }
      }
    }
    return out;
  }

  /** Extract delivery/read status notifications (no user content logged). */
  static parseStatuses(body) {
    const statuses = [];
    if (!body || typeof body !== 'object') return statuses;
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value || {};
        for (const st of Array.isArray(value.statuses) ? value.statuses : []) {
          if (!st || typeof st !== 'object') continue;
          statuses.push({
            id: st.id || null,
            status: st.status || 'unknown',
            errors: Array.isArray(st.errors) ? st.errors.map((e) => e.code) : [],
          });
        }
      }
    }
    return statuses;
  }

  /** Deduplicate by messageId across memory and persistent SQLite store. */
  claimMessage(messageId, uid = null) {
    if (!messageId) return true;
    const id = String(messageId);
    if (this.seenMemory.has(id)) return false;
    if (this.store?.webhooks && !this.store.webhooks.claim(id, uid)) {
      this.seenMemory.add(id);
      return false;
    }
    this.seenMemory.add(id);
    if (this.seenMemory.size > SEEN_MEMORY_LIMIT) {
      this.seenMemory = new Set([...this.seenMemory].slice(-Math.floor(SEEN_MEMORY_LIMIT / 2)));
    }
    return true;
  }

  /** Simple per-sender rate limiter to prevent abuse/runaway costs. */
  allowSenderRate(uid) {
    if (!uid || this.rateLimitPerMin <= 0) return true;
    const now = Date.now();
    const bucket = this.rateBuckets.get(uid);
    if (!bucket || now - bucket.windowStart > 60_000) {
      this.rateBuckets.set(uid, { windowStart: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.rateLimitPerMin;
  }

  /** Feed one parsed webhook body through the router and deliver the replies. */
  async handleWebhook(body, { correlationId = randomUUID() } = {}) {
    this.metrics.webhooksReceived += 1;

    const statuses = CloudApiChannel.parseStatuses(body);
    if (statuses.length) {
      this.metrics.statusNotifications += statuses.length;
      for (const st of statuses) {
        if (st.status === 'failed') {
          this.logEvent('warn', 'WHATSAPP_DELIVERY_STATUS_FAILED', {
            correlationId,
            errorCodes: st.errors,
          });
        }
      }
    }

    const parsed = CloudApiChannel.parseWebhook(body);
    const isMetaTestEvent = parsed.some(
      (m) => m.rawId === '16315551181' || m.messageId === 'ABGGFlA5FpafAgo6tHcNmNjXmuSf',
    );
    const eventKind = isMetaTestEvent
      ? 'webhook_test_event'
      : parsed.length > 0
        ? 'incoming_message'
        : statuses.length > 0
          ? 'status_notification'
          : 'unhandled_event';

    this.metrics.lastWebhookSummary = {
      ts: new Date().toISOString(),
      eventKind,
      messageCount: parsed.length,
      statusCount: statuses.length,
      messageTypes: parsed.map((m) => m.type),
    };
    this.logEvent('info', 'WEBHOOK_EVENT_CLASSIFIED', {
      correlationId,
      ...this.metrics.lastWebhookSummary,
    });

    const results = [];

    for (const msg of parsed) {
      const uid = this.store?.pseudonymise ? this.store.pseudonymise(msg.rawId) : null;

      if (!this.claimMessage(msg.messageId, uid)) {
        this.metrics.duplicatesDropped += 1;
        this.logEvent('info', 'WEBHOOK_DUPLICATE_DROPPED', { correlationId, eventKind });
        continue;
      }

      if (uid && !this.allowSenderRate(uid)) {
        this.logEvent('warn', 'SENDER_RATE_LIMITED', { correlationId });
        continue;
      }

      try {
        const { replies } = this.router.handle(msg.rawId, msg.text);
        for (const reply of replies) {
          const chunks = splitWhatsAppMessage(reply);
          for (const chunk of chunks) {
            await this.send(msg.rawId, chunk, { correlationId });
          }
        }
        this.metrics.messagesProcessed += 1;
        this.metrics.consecutiveWebhookFailures = 0;
        results.push({ rawId: msg.rawId, replies, messageId: msg.messageId });
      } catch (err) {
        this.metrics.messagesFailed += 1;
        this.metrics.consecutiveWebhookFailures += 1;
        this.logEvent('error', 'WEBHOOK_MESSAGE_PROCESSING_FAILED', {
          correlationId,
          eventKind,
          consecutiveFailures: this.metrics.consecutiveWebhookFailures,
          reason: String(err?.message ?? 'unknown error').slice(0, 160),
        });
        throw err;
      }
    }
    return results;
  }

  /**
   * Send an outbound text or interactive message through the official Graph API
   * with bounded retries and exponential backoff on transient failures (429 / 5xx / network).
   */
  async send(rawId, textOrPayload, options = {}) {
    if (!this.configured) {
      throw new Error('WhatsApp Cloud API is not configured (need WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN).');
    }

    const url = `${this.baseUrl}/${this.graphVersion}/${this.phoneNumberId}/messages`;

    const bodyPayload =
      typeof textOrPayload === 'object' && textOrPayload !== null && textOrPayload.type === 'interactive'
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: rawId,
            type: 'interactive',
            interactive: textOrPayload.interactive,
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: rawId,
            type: 'text',
            text: { preview_url: false, body: String(textOrPayload ?? '') },
          };

    let attempt = 0;
    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          this.metrics.outboundSent += 1;
          return await res.json().catch(() => ({}));
        }

        const status = Number(res.status) || 500;
        const retryable = status === 429 || status >= 500;
        if (retryable && attempt <= this.maxRetries) {
          this.metrics.outboundRetries += 1;
          const jitter = Math.floor(Math.random() * 50);
          const delay = this.baseDelayMs * 2 ** (attempt - 1) + jitter;
          await this.sleepImpl(delay);
          continue;
        }

        // Never log the message body, phone numbers, or the access token.
        const detail = await res.text().catch(() => '');
        let metaErrorCode = null;
        let metaErrorSubcode = null;
        let errorType = null;
        let rawErrMsg = detail;
        try {
          const parsedErr = JSON.parse(detail);
          if (parsedErr?.error) {
            metaErrorCode = parsedErr.error.code ?? null;
            metaErrorSubcode = parsedErr.error.error_subcode ?? null;
            errorType = parsedErr.error.type ?? null;
            rawErrMsg = parsedErr.error.message || detail;
          }
        } catch {
          /* non-JSON body */
        }

        const safeDetail = String(rawErrMsg)
          .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED]')
          .replaceAll(this.accessToken, '[REDACTED]')
          .replace(/\+?\b\d{10,15}\b/g, '[REDACTED_PHONE]')
          .slice(0, 200);

        this.metrics.lastOutboundError = {
          ts: new Date().toISOString(),
          httpStatus: status,
          metaErrorCode,
          metaErrorSubcode,
          errorType,
          reason: safeDetail,
        };
        this.logEvent('error', 'CLOUD_API_SEND_FAILED', {
          correlationId: options.correlationId || null,
          ...this.metrics.lastOutboundError,
        });

        throw new Error(`Cloud API send failed (${status}): ${safeDetail}`);
      } catch (err) {
        clearTimeout(timer);
        const isAbortOrNet =
          err?.name === 'AbortError' ||
          /network|fetch|timeout|ECONNRESET|ETIMEDOUT/i.test(String(err?.message ?? ''));
        if (isAbortOrNet && attempt <= this.maxRetries) {
          this.metrics.outboundRetries += 1;
          const jitter = Math.floor(Math.random() * 50);
          const delay = this.baseDelayMs * 2 ** (attempt - 1) + jitter;
          await this.sleepImpl(delay);
          continue;
        }
        this.metrics.outboundFailed += 1;
        throw err;
      }
    }
  }

  /**
   * Handle an incoming HTTP request (webhook GET/POST, /healthz, /readyz, /api/status, or static UI).
   */
  async handleHttpRequest(req, res) {
    const correlationId = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. Health & Readiness probes
    if (req.method === 'GET' && (pathname === '/healthz' || pathname === '/health')) {
      let dbOk = true;
      try {
        if (this.store) this.store.schemaVersion();
      } catch {
        dbOk = false;
      }
      const status = dbOk ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          status: dbOk ? 'ok' : 'degraded',
          service: 'debt-reality-checker',
          driver: this.store?.driver || 'none',
          schemaVersion: dbOk && this.store ? this.store.schemaVersion() : null,
        }),
      );
      return;
    }

    if (req.method === 'GET' && (pathname === '/readyz' || pathname === '/api/status')) {
      let dbOk = true;
      try {
        if (this.store) this.store.schemaVersion();
      } catch {
        dbOk = false;
      }
      const ready = dbOk && (this.env.NODE_ENV !== 'production' || this.configured);
      res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ready,
          channel: 'whatsapp-cloud',
          configured: this.configured,
          signatureVerificationRequired: this.requireSignature,
          graphVersion: this.graphVersion,
          webhookPath: this.webhookPath,
          dbDriver: this.store?.driver || 'none',
          metrics: this.metrics,
        }),
      );
      return;
    }

    // 2. Meta Webhook GET verification
    if (req.method === 'GET' && (pathname === this.webhookPath || pathname === '/api/webhook')) {
      const query = Object.fromEntries(parsedUrl.searchParams.entries());
      const v = this.verifyWebhook(query);
      if (v.ok) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(v.challenge ?? ''));
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Webhook verification failed' }));
      }
      return;
    }

    // 3. Meta Webhook POST delivery
    if (req.method === 'POST' && (pathname === this.webhookPath || pathname === '/api/webhook')) {
      let rawBody;
      try {
        rawBody = await readRawBody(req, this.maxBodyBytes);
      } catch (err) {
        if (err.code === 'PAYLOAD_TOO_LARGE') {
          this.metrics.webhooksRejected += 1;
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
        this.metrics.webhooksRejected += 1;
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Bad request body' }));
        return;
      }

      const sig = req.headers['x-hub-signature-256'];
      if (!this.verifySignature(rawBody, sig)) {
        this.metrics.webhooksRejected += 1;
        this.logEvent('warn', 'WEBHOOK_SIGNATURE_INVALID', { correlationId });
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid webhook signature' }));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        this.metrics.webhooksRejected += 1;
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Malformed JSON body' }));
        return;
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        this.metrics.webhooksRejected += 1;
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid webhook payload object' }));
        return;
      }

      // Acknowledge valid webhook immediately with 200 OK
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));

      // Process messages asynchronously (or await when synchronous test mode is requested)
      const task = this.handleWebhook(payload, { correlationId }).catch((err) => {
        this.logEvent('error', 'WEBHOOK_ASYNC_ERROR', {
          correlationId,
          message: String(err?.message ?? 'error').slice(0, 160),
        });
      });

      if (this.config?.awaitWebhookInHttp) {
        await task;
      }
      return;
    }

    // 4. Optional static web dashboard serving (if dist/web is built)
    if (req.method === 'GET' && this.staticDir && existsSync(this.staticDir)) {
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const candidate = resolve(this.staticDir, relPath);
      if (candidate.startsWith(this.staticDir) && existsSync(candidate) && statSync(candidate).isFile()) {
        const ext = extname(candidate).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(readFileSync(candidate));
        return;
      }
      const indexHtml = join(this.staticDir, 'index.html');
      if (!extname(pathname) && existsSync(indexHtml)) {
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(readFileSync(indexHtml));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /** Start the HTTP server listening on the configured PORT. */
  async start() {
    if (this.env.NODE_ENV === 'production') {
      CloudApiChannel.assertProductionConfig(this.env);
    }

    if (this.server) return this.server;

    this.server = createServer((req, res) => {
      this.handleHttpRequest(req, res).catch((err) => {
        this.logEvent('error', 'HTTP_UNHANDLED_ERROR', {
          reason: String(err?.message ?? 'unknown').slice(0, 160),
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    this.server.headersTimeout = 15_000;
    this.server.requestTimeout = 15_000;

    await new Promise((resolveListen, rejectListen) => {
      this.server.once('error', rejectListen);
      this.server.listen(this.port, '0.0.0.0', () => {
        const addr = this.server.address();
        if (addr && typeof addr === 'object') this.port = addr.port;
        this.logEvent('info', 'CLOUD_API_SERVER_LISTENING', {
          port: this.port,
          webhookPath: this.webhookPath,
          configured: this.configured,
        });
        resolveListen();
      });
    });

    return this.server;
  }

  async stop() {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise((resolveClose) => srv.close(() => resolveClose()));
  }
}

/** Read raw request buffer with a hard byte limit. */
function readRawBody(req, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBytes) {
        rejected = true;
        const err = new Error('Payload too large');
        err.code = 'PAYLOAD_TOO_LARGE';
        rejectBody(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) resolveBody(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      if (!rejected) rejectBody(err);
    });
  });
}

export default { CloudApiChannel, GRAPH_VERSION, splitWhatsAppMessage };
