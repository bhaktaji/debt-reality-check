/**
 * bot/index.js
 * Entry point for the messaging surface.
 *
 *   node bot/index.js                     # console channel (no credentials needed)
 *   node bot/index.js --channel baileys   # personal prototype (allow-list / self-chat)
 *   node bot/index.js --channel cloud     # official WhatsApp Cloud API (production)
 *
 * On boot it purges data for inactive users (retention TTL) and then starts the channel.
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainModule } from '../tools/is_main.js';
import { openDatabase } from '../store/db.js';
import { createChannel } from './channel.js';
import { DEFAULT_RETENTION_DAYS, retentionNotice } from '../store/retention.js';
import { BaileysChannel } from './whatsapp_baileys.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v ?? argv[i + 1] ?? true;
      if (v === undefined && argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
    }
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  // `--logout` clears the stored WhatsApp session. It runs before anything else so it
  // works even when the session is the thing that is broken.
  if (args.logout) {
    const dir = resolve(String(args['auth-dir'] || process.env.BAILEYS_AUTH_DIR || 'auth_info_baileys'));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      process.stdout.write(`Cleared the WhatsApp session at ${dir}\nStart again with: npm run bot:whatsapp\n`);
    } else {
      process.stdout.write(`No WhatsApp session found at ${dir} - nothing to clear.\n`);
    }
    return { loggedOut: true };
  }

  const channelName = String(args.channel || process.env.DRC_CHANNEL || 'console').toLowerCase();
  const retentionDays = Number(process.env.DRC_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);

  if (channelName === 'baileys') {
    BaileysChannel.assertSafeConfig();
    process.stderr.write(
      '\n!! Unofficial WhatsApp adapter (Baileys). Personal prototype only.\n' +
        '!! Accounts can be restricted. Never point this at the public.\n' +
        '!! Use --channel cloud for anything public.\n\n',
    );
  }

  if (channelName === 'cloud' && process.env.NODE_ENV === 'production') {
    const { CloudApiChannel } = await import('./whatsapp_cloud.js');
    CloudApiChannel.assertProductionConfig(process.env);
  }

  const store = openDatabase({});
  process.stdout.write(`Storage: ${store.driver} on Node ${process.version}\n`);

  const purged = store.retention.purgeInactive(retentionDays);
  if (purged.users) {
    process.stdout.write(`Retention: purged ${purged.users} inactive user(s) older than ${retentionDays} days.\n`);
  }
  if (args['print-notice']) {
    process.stdout.write(`${retentionNotice(retentionDays)}\n`);
  }

  const { channel } = await createChannel({ channel: channelName, store, config: { retentionDays } });

  // Run periodic retention sweep every 6 hours so long-lived production servers do not
  // depend on restarts to enforce data retention TTL.
  const retentionIntervalMs = Number(process.env.DRC_RETENTION_INTERVAL_MS || 6 * 60 * 60 * 1000);
  const retentionTimer = setInterval(() => {
    try {
      store.retention.purgeInactive(retentionDays);
    } catch {
      /* ignore background sweep errors */
    }
  }, retentionIntervalMs);
  retentionTimer.unref?.();

  const shutdown = async () => {
    clearInterval(retentionTimer);
    await channel.stop();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await channel.start();
  return { channel, store, stop: async () => { clearInterval(retentionTimer); await channel.stop(); store.close(); } };
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

export default { main };
