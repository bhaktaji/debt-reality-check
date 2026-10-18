/**
 * bot/whatsapp_cloud.js
 * Official WhatsApp Cloud API adapter - the PRODUCTION path (F-14, E.2).
 *
 * Requires Meta business verification, a phone number id and a permanent token. Pricing
 * and the free service-message allowance change; check Meta's current documentation
 * before relying on any cost figure.
 *
 * This adapter is deliberately a thin transport: it converts a webhook payload into
 * (rawId, text), feeds the shared router, and posts replies back. It contains no
 * financial logic. It can be constructed and unit-tested with no network access by
 * injecting a fetch implementation.
 */

import { Channel } from './channel.js';

const GRAPH_VERSION = 'v21.0';

export class CloudApiChannel extends Channel {
  /**
   * @param {{router:object, config?:object}} options
   * config: { phoneNumberId, accessToken, verifyToken, graphVersion, fetchImpl, baseUrl }
   */
  constructor({ router, config = {} }) {
    super('whatsapp-cloud');
    this.router = router;
    this.phoneNumberId = config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.accessToken = config.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
    this.verifyToken = config.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN;
    this.graphVersion = config.graphVersion || GRAPH_VERSION;
    this.baseUrl = config.baseUrl || 'https://graph.facebook.com';
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
  }

  get configured() {
    return Boolean(this.phoneNumberId && this.accessToken);
  }

  /** Meta's GET verification handshake. */
  verifyWebhook(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode === 'subscribe' && token === this.verifyToken) return { ok: true, challenge };
    return { ok: false };
  }

  /** Parse an inbound webhook body into messages. Ignores statuses and groups. */
  static parseWebhook(body) {
    const out = [];
    for (const entry of body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const msg of value.messages || []) {
          if (!msg.from) continue;
          const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? '';
          if (!text) continue;
          out.push({ rawId: msg.from, text: String(text).trim(), messageId: msg.id });
        }
      }
    }
    return out;
  }

  /** Feed one parsed webhook body through the router and deliver the replies. */
  async handleWebhook(body) {
    const results = [];
    for (const msg of CloudApiChannel.parseWebhook(body)) {
      const { replies } = this.router.handle(msg.rawId, msg.text);
      for (const reply of replies) await this.send(msg.rawId, reply);
      results.push({ rawId: msg.rawId, replies });
    }
    return results;
  }

  async send(rawId, text) {
    if (!this.configured) {
      throw new Error('WhatsApp Cloud API is not configured (need WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN).');
    }
    const url = `${this.baseUrl}/${this.graphVersion}/${this.phoneNumberId}/messages`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: rawId,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) {
      // Never log the message body or the token.
      const detail = await res.text().catch(() => '');
      throw new Error(`Cloud API send failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }
}

export default { CloudApiChannel, GRAPH_VERSION };
