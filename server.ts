/**
 * server.ts
 * Entry point for Cloud Run / AI Studio full-stack deployment (`"start": "node server.ts"`).
 */

import { startServer } from './server.js';

startServer()
  .then(({ server, shutdown }) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3000;
    process.stdout.write(`Debt Reality Checker server listening on http://0.0.0.0:${port}\n`);
    process.on('SIGINT', async () => {
      await shutdown();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await shutdown();
      process.exit(0);
    });
  })
  .catch((err) => {
    process.stderr.write(`${err?.message || err}\n`);
    process.exit(1);
  });
