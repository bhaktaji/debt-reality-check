import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../store/db.js';
import { createRouter } from '../../bot/router.js';
import { CloudApiChannel, splitWhatsAppMessage, GRAPH_VERSION } from '../../bot/whatsapp_cloud.js';
import { diagnoseProfile } from '../../core/profile.js';
import { profileFromStore } from '../../store/mappers.js';

const SECRET = 'cloud-api-test-secret-1234567890';
const APP_SECRET = 'meta-app-secret-test-key-9876543210';
const VERIFY_TOKEN = 'verify-token-secret-123';
const PHONE_ID = '109876543210';
const ACCESS_TOKEN = 'EAABsbCS1iHgBOtesttoken123456';

let store;
let router;

beforeEach(() => {
  store = openDatabase({ path: ':memory:', secret: SECRET });
  router = createRouter({ store, config: { retentionDays: 90 } });
});

afterEach(() => {
  store?.close();
});

function makeCloudChannel(overrides = {}) {
  const sentRequests = [];
  const fetchImpl = overrides.fetchImpl || (async (url, init) => {
    const body = JSON.parse(init.body);
    sentRequests.push({ url, headers: init.headers, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: `wamid.out.${sentRequests.length}` }] }),
      text: async () => 'OK',
    };
  });

  const channel = new CloudApiChannel({
    router,
    store,
    config: {
      phoneNumberId: PHONE_ID,
      accessToken: ACCESS_TOKEN,
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      fetchImpl,
      sleepImpl: async () => {},
      silentLogs: true,
      awaitWebhookInHttp: true,
      ...overrides,
    },
  });

  return { channel, sentRequests };
}

function buildWebhookPayload(messages = [], statuses = []) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: PHONE_ID },
              messages,
              statuses,
            },
          },
        ],
      },
    ],
  };
}

function signBody(rawString, secret = APP_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(rawString, 'utf8').digest('hex')}`;
}

describe('Webhook GET verification & invalid tokens', () => {
  it('accepts a valid subscribe handshake with the configured verification token', () => {
    const { channel } = makeCloudChannel();
    const res = channel.verifyWebhook({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    });
    expect(res).toEqual({ ok: true, challenge: '1158201444' });
    expect(channel.metrics.webhooksVerified).toBe(1);
  });

  it('rejects an invalid verification token or wrong hub.mode', () => {
    const { channel } = makeCloudChannel();
    expect(
      channel.verifyWebhook({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '1158201444',
      }).ok,
    ).toBe(false);

    expect(
      channel.verifyWebhook({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      }).ok,
    ).toBe(false);

    expect(channel.metrics.webhooksRejected).toBe(2);
  });
});

describe('Webhook X-Hub-Signature-256 verification', () => {
  it('validates a genuine HMAC-SHA256 signature and rejects tampered payloads or wrong secrets', () => {
    const { channel } = makeCloudChannel();
    const raw = JSON.stringify(buildWebhookPayload([{ from: '919812345678', id: 'm1', text: { body: 'HELP' } }]));
    const validSig = signBody(raw, APP_SECRET);

    expect(channel.verifySignature(raw, validSig)).toBe(true);
    expect(channel.verifySignature(raw, signBody(raw, 'wrong-secret'))).toBe(false);
    expect(channel.verifySignature(`${raw} `, validSig)).toBe(false);
    expect(channel.verifySignature(raw, 'sha256=not-a-hex-digest')).toBe(false);
    expect(channel.verifySignature(raw, '')).toBe(false);
    expect(channel.verifySignature(raw, undefined)).toBe(false);
    expect(channel.metrics.signatureFailures).toBe(5);
  });
});

describe('Payload parsing, malformed payloads & unsupported message types', () => {
  it('parses text, button, and interactive list replies cleanly', () => {
    const body = buildWebhookPayload([
      { from: '919800000001', id: 'm1', type: 'text', text: { body: '  AGREE  ' } },
      { from: '919800000002', id: 'm2', type: 'button', button: { text: 'AUDIT' } },
      {
        from: '919800000003',
        id: 'm3',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'YES', title: 'Yes' } },
      },
      {
        from: '919800000004',
        id: 'm4',
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: '1', title: 'Credit card' } },
      },
    ]);
    const parsed = CloudApiChannel.parseWebhook(body);
    expect(parsed).toEqual([
      { rawId: '919800000001', text: 'AGREE', messageId: 'm1', type: 'text' },
      { rawId: '919800000002', text: 'AUDIT', messageId: 'm2', type: 'text' },
      { rawId: '919800000003', text: 'YES', messageId: 'm3', type: 'text' },
      { rawId: '919800000004', text: '1', messageId: 'm4', type: 'text' },
    ]);
  });

  it('safely handles malformed payloads and ignores status broadcasts / groups', () => {
    expect(CloudApiChannel.parseWebhook(null)).toEqual([]);
    expect(CloudApiChannel.parseWebhook({})).toEqual([]);
    expect(CloudApiChannel.parseWebhook({ entry: 'not-an-array' })).toEqual([]);
    expect(
      CloudApiChannel.parseWebhook(
        buildWebhookPayload([
          { from: '12345@g.us', id: 'g1', text: { body: 'group msg' } },
          { from: 'status@broadcast', id: 's1', text: { body: 'status msg' } },
        ]),
      ),
    ).toEqual([]);
  });

  it('flags unsupported message types (image/audio/document/location) and replies politely', async () => {
    const { channel, sentRequests } = makeCloudChannel();
    const user = '919811112222';

    // First grant consent so the user is past the first-contact gate
    await channel.handleWebhook(
      buildWebhookPayload([{ from: user, id: 'msg-agree', type: 'text', text: { body: 'AGREE' } }]),
    );
    sentRequests.length = 0;

    // Now send an image without text
    await channel.handleWebhook(
      buildWebhookPayload([{ from: user, id: 'msg-img-1', type: 'image', image: { id: 'img123' } }]),
    );

    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0].body.text.body).toMatch(/only read text messages/i);
  });

  it('handles delivery status notifications without throwing or sending replies', async () => {
    const { channel, sentRequests } = makeCloudChannel();
    const payload = buildWebhookPayload(
      [],
      [
        { id: 'wamid.1', status: 'delivered' },
        { id: 'wamid.2', status: 'failed', errors: [{ code: 131047 }] },
      ],
    );
    const res = await channel.handleWebhook(payload);
    expect(res).toEqual([]);
    expect(sentRequests).toHaveLength(0);
    expect(channel.metrics.statusNotifications).toBe(2);
  });
});

describe('Duplicate webhook deliveries & persistent idempotency', () => {
  it('drops duplicate webhook deliveries in memory and across channel restarts via SQLite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drc-cloud-dup-'));
    const dbPath = join(dir, 'test.sqlite');

    try {
      const store1 = openDatabase({ path: dbPath, secret: SECRET });
      const router1 = createRouter({ store: store1 });
      const { channel: chan1, sentRequests: sent1 } = makeCloudChannel({
        router: router1,
        store: store1,
      });

      const payload = buildWebhookPayload([
        { from: '919812345678', id: 'wamid.unique.100', type: 'text', text: { body: 'AGREE' } },
      ]);

      await chan1.handleWebhook(payload);
      expect(sent1).toHaveLength(1);

      // Deliver exact same webhook again to chan1
      await chan1.handleWebhook(payload);
      expect(sent1).toHaveLength(1);
      expect(chan1.metrics.duplicatesDropped).toBe(1);
      store1.close();

      // Simulate process restart with fresh memory, reopening the same SQLite database
      const store2 = openDatabase({ path: dbPath, secret: SECRET });
      const router2 = createRouter({ store: store2 });
      const { channel: chan2, sentRequests: sent2 } = makeCloudChannel({
        router: router2,
        store: store2,
      });

      await chan2.handleWebhook(payload);
      expect(sent2).toHaveLength(0);
      expect(chan2.metrics.duplicatesDropped).toBe(1);
      store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Outbound Graph API, retries, rate limits & error handling', () => {
  it('uses configured Graph API version and sends text and interactive payloads', async () => {
    const { channel, sentRequests } = makeCloudChannel({ graphVersion: 'v22.0' });
    await channel.send('919812345678', 'Hello world');
    expect(sentRequests[0].url).toBe(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`);
    expect(sentRequests[0].headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(sentRequests[0].body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919812345678',
      type: 'text',
      text: { preview_url: false, body: 'Hello world' },
    });

    await channel.send('919812345678', {
      type: 'interactive',
      interactive: { type: 'button', body: { text: 'Confirm?' } },
    });
    expect(sentRequests[1].body.type).toBe('interactive');
  });

  it('retries on 429 rate-limit and 503 transient errors with bounded backoff, then succeeds', async () => {
    let attempts = 0;
    const { channel } = makeCloudChannel({
      maxRetries: 3,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return { ok: false, status: 429, text: async () => 'Rate limit hit' };
        if (attempts === 2) return { ok: false, status: 503, text: async () => 'Service unavailable' };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    });

    await channel.send('919812345678', 'Retry test');
    expect(attempts).toBe(3);
    expect(channel.metrics.outboundRetries).toBe(2);
    expect(channel.metrics.outboundSent).toBe(1);
  });

  it('does NOT retry on 400/401 client errors and redacts tokens from error messages', async () => {
    let attempts = 0;
    const { channel } = makeCloudChannel({
      maxRetries: 3,
      fetchImpl: async () => {
        attempts += 1;
        return {
          ok: false,
          status: 401,
          text: async () => `Invalid token Bearer ${ACCESS_TOKEN}`,
        };
      },
    });

    await expect(channel.send('919812345678', 'Auth fail')).rejects.toThrow(/\[REDACTED\]/);
    expect(attempts).toBe(1);
    expect(channel.metrics.outboundFailed).toBe(1);
  });

  it('stops retrying after maxRetries on persistent 500 errors', async () => {
    let attempts = 0;
    const { channel } = makeCloudChannel({
      maxRetries: 2,
      fetchImpl: async () => {
        attempts += 1;
        return { ok: false, status: 500, text: async () => 'Upstream down' };
      },
    });

    await expect(channel.send('919812345678', 'Persistent fail')).rejects.toThrow(/Cloud API send failed \(500\)/);
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });
});

describe('End-to-end conversation, editing answers, restart recovery & multi-user isolation', () => {
  it('completes an audit, allows editing an earlier answer to recompute, and answers follow-up questions', async () => {
    const { channel, sentRequests } = makeCloudChannel();
    const user = '919876543210';
    let msgSeq = 0;
    const sendMsg = async (text) => {
      msgSeq += 1;
      const before = sentRequests.length;
      await channel.handleWebhook(
        buildWebhookPayload([{ from: user, id: `wamid.${msgSeq}`, type: 'text', text: { body: text } }]),
      );
      return sentRequests.slice(before).map((r) => r.body.text.body).join('\n');
    };

    // 1. First contact -> privacy notice
    const first = await sendMsg('Hello');
    expect(first).toContain('Debt Reality Check');
    expect(first).toContain('AGREE');

    // 2. Consent
    expect(await sendMsg('AGREE')).toContain('Consent recorded');

    // 3. Start audit
    expect(await sendMsg('AUDIT')).toMatch(/Q1\./);
    await sendMsg('60,000');
    await sendMsg('yes');
    await sendMsg('skip'); // steady income
    await sendMsg('15,000'); // rent
    await sendMsg('yes');
    await sendMsg('20,000'); // core expenses
    await sendMsg('yes');
    await sendMsg('50,000'); // liquid reserves
    await sendMsg('yes');
    await sendMsg('1'); // earners
    await sendMsg('1'); // dependents
    await sendMsg('no'); // family help

    // Add 1 debt
    await sendMsg('ICICI Card');
    await sendMsg('1'); // credit card
    await sendMsg('no'); // unsecured
    await sendMsg('50,000');
    await sendMsg('yes');
    await sendMsg('2,500');
    await sendMsg('yes');
    await sendMsg('36');
    await sendMsg('1,00,000');
    const summaryReply = await sendMsg('yes');
    expect(summaryReply).toMatch(/Added ICICI Card/);

    const confirmScreen = await sendMsg('done');
    expect(confirmScreen).toContain('Here is what I have');
    expect(confirmScreen).toContain('₹60,000/month');

    // 4. Edit an earlier answer before running the diagnostic
    const editPrompt = await sendMsg('EDIT INCOME');
    expect(editPrompt).toMatch(/Q1\./);
    await sendMsg('1,00,000');
    const updatedConfirm = await sendMsg('yes');
    expect(updatedConfirm).toContain('Here is what I have');
    expect(updatedConfirm).toContain('₹1,00,000/month');

    // 5. Run the diagnostic
    const reportOut = await sendMsg('DONE');
    expect(reportOut).toContain('YOUR DEBT REALITY CHECK');
    expect(reportOut).toContain('YOUR DEBT PAYOFF PLAN');

    // Verify engine parity with stored profile
    const uid = store.pseudonymise(user);
    const storedProfile = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(storedProfile.netIncome).toBe(100000);
    const directDiag = diagnoseProfile(storedProfile);
    expect(store.audits.latest(uid).tier).toBe(directDiag.tier);

    // 6. Follow-up questions about the result
    expect(await sendMsg('WHY')).toContain(`Tier ${directDiag.tier} of 4`);
    expect(await sendMsg('STRATEGY')).toContain('YOUR DEBT PAYOFF PLAN');
    expect(await sendMsg('NEXT STEPS')).toContain('WHAT I WOULD FOCUS ON NEXT');

    // 7. Cancel and resume an incomplete conversation
    await sendMsg('AUDIT');
    await sendMsg('80,000');
    await sendMsg('yes');
    expect(await sendMsg('CANCEL')).toMatch(/Cancelled/);
    const resumed = await sendMsg('RESUME');
    expect(resumed).toMatch(/Resuming your audit/);
    expect(resumed).toMatch(/Q2\./);

    // 8. Delete personal data completely
    expect(await sendMsg('DELETE MY DATA')).toMatch(/erased/);
    expect(store.users.get(uid)).toBeNull();
    expect(store.debts.list(uid)).toHaveLength(0);
    expect(store.audits.list(uid)).toHaveLength(0);
    expect(store.consent.hasConsent(uid)).toBe(false);
  });

  it('isolates concurrent conversations and data between separate WhatsApp users', async () => {
    const { channel } = makeCloudChannel();
    const userA = '919800000001';
    const userB = '919800000002';

    await channel.handleWebhook(
      buildWebhookPayload([
        { from: userA, id: 'a1', text: { body: 'AGREE' } },
        { from: userB, id: 'b1', text: { body: 'AGREE' } },
        { from: userA, id: 'a2', text: { body: 'AUDIT' } },
        { from: userB, id: 'b2', text: { body: 'medicine 400' } },
        { from: userA, id: 'a3', text: { body: '75000' } },
        { from: userA, id: 'a4', text: { body: 'yes' } },
      ]),
    );

    const uidA = store.pseudonymise(userA);
    const uidB = store.pseudonymise(userB);
    expect(uidA).not.toBe(uidB);

    // User A is on step incomeHistory with draft netIncome 75000, 0 expenses
    expect(store.users.get(uidA).state.step).toBe('incomeHistory');
    expect(store.users.get(uidA).state.draft.netIncome).toBe(75000);
    expect(store.expenses.listAll(uidA)).toHaveLength(0);

    // User B is in idle mode with 1 logged expense of Rs 400
    expect(store.users.get(uidB).state.mode).toBe('idle');
    expect(store.expenses.listAll(uidB)).toHaveLength(1);
    expect(store.expenses.listAll(uidB)[0].amount).toBe(400);
  });

  it('recovers mid-audit conversation state across application restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drc-restart-'));
    const dbPath = join(dir, 'restart.sqlite');
    const user = '919899998888';

    try {
      const store1 = openDatabase({ path: dbPath, secret: SECRET });
      const router1 = createRouter({ store: store1 });
      router1.handle(user, 'AGREE');
      router1.handle(user, 'AUDIT');
      router1.handle(user, '50000');
      router1.handle(user, 'yes');
      store1.close();

      // Reopen store and router (simulating container/server restart)
      const store2 = openDatabase({ path: dbPath, secret: SECRET });
      const router2 = createRouter({ store: store2 });
      const { replies } = router2.handle(user, 'skip'); // answers Q2 (incomeHistory)
      expect(replies.join('\n')).toMatch(/Q3\./);
      store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HTTP server endpoints (/webhook, /healthz, /readyz) & production config validation', () => {
  it('serves /healthz, /readyz, GET /webhook, and POST /webhook over HTTP', async () => {
    const { channel, sentRequests } = makeCloudChannel({ port: 0 });
    await channel.start();

    try {
      const base = `http://127.0.0.1:${channel.port}`;

      // 1. /healthz
      const healthRes = await fetch(`${base}/healthz`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson.status).toBe('ok');
      expect(healthJson.schemaVersion).toBe(2);

      // 2. /readyz
      const readyRes = await fetch(`${base}/readyz`);
      expect(readyRes.status).toBe(200);
      const readyJson = await readyRes.json();
      expect(readyJson.ready).toBe(true);
      expect(readyJson.graphVersion).toBe(GRAPH_VERSION);

      // 3. GET /webhook verification
      const verifyOk = await fetch(
        `${base}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=998877`,
      );
      expect(verifyOk.status).toBe(200);
      expect(await verifyOk.text()).toBe('998877');

      const verifyFail = await fetch(
        `${base}/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=998877`,
      );
      expect(verifyFail.status).toBe(403);

      // 4. POST /webhook without signature -> 401
      const bodyStr = JSON.stringify(
        buildWebhookPayload([{ from: '919812345678', id: 'http-m1', text: { body: 'HELP' } }]),
      );
      const unsignedRes = await fetch(`${base}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });
      expect(unsignedRes.status).toBe(401);

      // 5. POST /webhook with valid signature -> 200 and sends reply
      const signedRes = await fetch(`${base}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signBody(bodyStr, APP_SECRET),
        },
        body: bodyStr,
      });
      expect(signedRes.status).toBe(200);
      expect(sentRequests).toHaveLength(1);
      expect(sentRequests[0].body.text.body).toContain('COMMANDS');

      // 6. Malformed JSON -> 400
      const malformedRaw = '{bad json';
      const malformedRes = await fetch(`${base}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signBody(malformedRaw, APP_SECRET),
        },
        body: malformedRaw,
      });
      expect(malformedRes.status).toBe(400);
    } finally {
      await channel.stop();
    }
  });

  it('fails clearly when required production secrets are missing', async () => {
    expect(() => CloudApiChannel.assertProductionConfig({ NODE_ENV: 'production' })).toThrow(
      /PSEUDONYM_SECRET.*WHATSAPP_PHONE_NUMBER_ID.*WHATSAPP_ACCESS_TOKEN.*WHATSAPP_VERIFY_TOKEN.*WHATSAPP_APP_SECRET/,
    );
    expect(() =>
      CloudApiChannel.assertProductionConfig({
        NODE_ENV: 'production',
        PSEUDONYM_SECRET: 'a'.repeat(32),
        WHATSAPP_PHONE_NUMBER_ID: '123',
        WHATSAPP_ACCESS_TOKEN: 'tok',
        WHATSAPP_VERIFY_TOKEN: 'ver',
        WHATSAPP_APP_SECRET: 'sec',
      }),
    ).not.toThrow();

    const { startServer } = await import('../../server.js');
    await expect(
      startServer({ env: { NODE_ENV: 'production' }, skipVite: true, port: 0 }),
    ).rejects.toThrow(/missing required configuration: PSEUDONYM_SECRET/);
  });

  it('splits long WhatsApp messages cleanly under the 4096-character limit', () => {
    const longText = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: Some financial explanation text here.`).join('\n');
    const chunks = splitWhatsAppMessage(longText, 1000);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1000);
    }
  });
});
