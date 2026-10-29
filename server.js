/**
 * server.js
 * Unified development & production HTTP server for AI Studio / Cloud Run.
 *
 * Serves:
 *   - GET  /healthz, /readyz, /api/status   (operational health & readiness probes)
 *   - GET  /webhook, /api/webhook           (Meta WhatsApp Cloud API verification)
 *   - POST /webhook, /api/webhook           (Meta WhatsApp Cloud API inbound events)
 *   - POST /api/sim/message                 (Local deterministic WhatsApp conversation simulator)
 *   - POST /api/sim/reset                   (Reset local simulator session)
 *   - Static web dashboard (in production from dist/web or dist, or via Vite middleware in dev)
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './store/db.js';
import { createRouter } from './bot/router.js';
import { CloudApiChannel } from './bot/whatsapp_cloud.js';
import { DEFAULT_RETENTION_DAYS } from './store/retention.js';
import { isMainModule } from './tools/is_main.js';

/** Load local `.env` into target env if present on disk without overwriting existing env vars. */
function loadDotEnv(targetEnv = process.env, envPath = resolve('.env')) {
  try {
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (targetEnv[key] === undefined || targetEnv[key] === '') {
        targetEnv[key] = val;
      }
    }
  } catch {
    /* ignore .env read errors in locked-down containers */
  }
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejectBody(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', rejectBody);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Open SQLite using process.env secrets, falling back to /tmp only for filesystem path permissions. */
function openResilientDatabase(env) {
  try {
    return openDatabase({ env });
  } catch (err) {
    if (err?.name === 'MissingSecretError') throw err;
    try {
      return openDatabase({ path: '/tmp/debt_reality.sqlite', env });
    } catch (fallbackErr) {
      if (fallbackErr?.name === 'MissingSecretError') throw fallbackErr;
      return openDatabase({ path: ':memory:', env });
    }
  }
}

export async function startServer(options = {}) {
  if (!options.env) {
    loadDotEnv(process.env);
  }
  const env = options.env || process.env;
  const port = Number(options.port ?? env.PORT ?? 3000);
  const retentionDays = Number(env.DRC_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);

  if (env.NODE_ENV === 'production') {
    CloudApiChannel.assertProductionConfig(env);
  }

  const store = options.store || openResilientDatabase(env);
  try {
    store.retention.purgeInactive(retentionDays);
  } catch {
    /* ignore initial retention sweep errors */
  }

  const staticDir = existsSync(resolve('dist/web'))
    ? resolve('dist/web')
    : resolve('dist');

  const router = createRouter({ store, config: { retentionDays } });
  const cloudChannel = new CloudApiChannel({
    router,
    store,
    config: {
      env,
      port,
      staticDir,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      appSecret: env.WHATSAPP_APP_SECRET,
      requireSignature: env.NODE_ENV === 'production' || Boolean(env.WHATSAPP_APP_SECRET),
    },
  });

  let vite = null;
  const hasBuiltStatic = existsSync(resolve(staticDir, 'index.html'));
  if (env.NODE_ENV !== 'production' && !options.skipVite && !hasBuiltStatic) {
    try {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        configFile: resolve('web/vite.config.js'),
        server: { middlewareMode: true, hmr: env.DISABLE_HMR !== 'true' },
        appType: 'spa',
      });
    } catch {
      vite = null;
    }
  } else if (env.NODE_ENV !== 'production' && !options.skipVite) {
    try {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        configFile: resolve('web/vite.config.js'),
        server: { middlewareMode: true, hmr: env.DISABLE_HMR !== 'true' },
        appType: 'spa',
      });
    } catch {
      vite = null;
    }
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (
        pathname === '/healthz' ||
        pathname === '/health' ||
        pathname === '/readyz' ||
        pathname === '/api/status' ||
        pathname === '/webhook' ||
        pathname === '/api/webhook'
      ) {
        await cloudChannel.handleHttpRequest(req, res);
        return;
      }

      if (pathname === '/api/sim/message' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = String(body?.sessionId || 'sim:local-preview').slice(0, 64);
        const text = String(body?.text ?? '');
        const out = router.handle(`sim:${sessionId}`, text);
        const uid = store.pseudonymise(`sim:${sessionId}`);
        sendJson(res, 200, {
          ok: true,
          replies: out.replies,
          escalated: Boolean(out.escalated),
          hasConsent: store.consent.hasConsent(uid),
          stateMode: out.state?.mode || 'idle',
          stateStep: out.state?.step || null,
        });
        return;
      }

      if (pathname === '/api/sim/reset' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = String(body?.sessionId || 'sim:local-preview').slice(0, 64);
        const uid = store.pseudonymise(`sim:${sessionId}`);
        store.retention.deleteAllFor(uid);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (vite) {
        vite.middlewares(req, res);
        return;
      }

      await cloudChannel.handleHttpRequest(req, res);
    } catch (err) {
      const status = err.statusCode || 500;
      if (!res.headersSent) {
        sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
      }
    }
  });

  const retentionTimer = setInterval(() => {
    try {
      store.retention.purgeInactive(retentionDays);
    } catch {
      /* ignore background sweep errors */
    }
  }, 6 * 60 * 60 * 1000);
  retentionTimer.unref?.();

  await new Promise((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(port, '0.0.0.0', () => resolveListen());
  });

  const shutdown = async () => {
    clearInterval(retentionTimer);
    if (vite) {
      await vite.close();
    }
    await new Promise((r) => httpServer.close(() => r()));
    store.close();
  };

  return { server: httpServer, store, router, cloudChannel, shutdown };
}

if (isMainModule(import.meta.url)) {
  startServer().then(({ server, shutdown }) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3000;
    process.stdout.write(`Debt Reality Checker server listening on http://0.0.0.0:${port}\n`);
    process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
    process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
  }).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

export default { startServer };
