/**
 * bot/channel.js
 * Channel abstraction. The router knows nothing about WhatsApp; adapters translate
 * transport <-> (rawId, text).
 *
 * Primary architecture does NOT depend on unofficial WhatsApp (F-14). The unofficial
 * Baileys adapter is a personal-prototype convenience behind configuration; the official
 * Cloud API adapter is the production path.
 *
 * Contract for every adapter:
 *  - present a stable rawId per consenting user;
 *  - never deliver group or status traffic;
 *  - dedupe messages by id so a reconnect cannot double-process;
 *  - never log message bodies.
 */

import { createInterface } from 'node:readline';
import { createRouter } from './router.js';

/** Base class documenting the contract. */
export class Channel {
  constructor(name) {
    this.name = name;
  }

  /** Begin delivering inbound messages. */
  async start() {
    throw new Error(`${this.name}: start() not implemented`);
  }

  /** Stop and release resources. */
  async stop() {}

  /** Send a reply to a user. */
  async send() {
    throw new Error(`${this.name}: send() not implemented`);
  }
}

/**
 * Local console channel: reads stdin, prints replies. Used by `npm run bot -- --channel console`
 * and by the demo so the whole flow can be exercised with no credentials.
 */
export class ConsoleChannel extends Channel {
  constructor({ router, input = process.stdin, output = process.stdout, rawId = 'console:local' } = {}) {
    super('console');
    this.router = router;
    this.input = input;
    this.output = output;
    this.rawId = rawId;
  }

  async start() {
    this.rl = createInterface({ input: this.input, output: this.output, terminal: false });
    this.output.write('Debt Reality Check (console channel). Type HELP. Ctrl-C to exit.\n');
    for await (const line of this.rl) {
      const text = line.trim();
      if (!text) continue;
      if (text === 'EXIT' || text === 'QUIT') break;
      const { replies } = this.router.handle(this.rawId, text);
      for (const r of replies) this.output.write(`\n${r}\n`);
    }
    await this.stop();
  }

  async send(_rawId, text) {
    this.output.write(`\n${text}\n`);
  }

  async stop() {
    this.rl?.close();
  }
}

/** A no-op sink used in tests: collect replies instead of printing them. */
export class MemoryChannel extends Channel {
  constructor({ router, rawId = 'test:user' } = {}) {
    super('memory');
    this.router = router;
    this.rawId = rawId;
    this.sent = [];
  }

  async start() {}

  async send(rawId, text) {
    this.sent.push({ rawId, text });
  }

  /** Feed one inbound message and return the replies. */
  receive(text, rawId = this.rawId) {
    const out = this.router.handle(rawId, text);
    this.sent.push(...out.replies.map((r) => ({ rawId, text: r })));
    return out;
  }
}

/**
 * Build the router plus the configured channel.
 * @param {{channel?:string, store:object, config?:object}} options
 */
export async function createChannel({ channel, store, config = {} } = {}) {
  const router = createRouter({ store, config });

  switch ((channel || config.channel || 'console').toLowerCase()) {
    case 'console': {
      return { channel: new ConsoleChannel({ router }), router };
    }
    case 'memory': {
      return { channel: new MemoryChannel({ router }), router };
    }
    case 'baileys': {
      const { BaileysChannel } = await import('./whatsapp_baileys.js');
      return { channel: new BaileysChannel({ router, config }), router };
    }
    case 'cloud': {
      const { CloudApiChannel } = await import('./whatsapp_cloud.js');
      return { channel: new CloudApiChannel({ router, store, config }), router };
    }
    default:
      throw new Error(`Unknown channel "${channel}". Use console, baileys or cloud.`);
  }
}

export default { Channel, ConsoleChannel, MemoryChannel, createChannel };
