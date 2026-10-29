/**
 * tools/build_web.js
 * Builds the Vite dashboard into `dist/web` and mirrors the static output into `dist/`
 * so both `dist/web/index.html` (CLI/bot static path) and `dist/index.html` (Cloud Run / SPA hosts) exist.
 */

import { build } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function runBuild() {
  const configFile = resolve('web/vite.config.js');
  await build({ configFile });

  const distWeb = resolve('dist/web');
  const distRoot = resolve('dist');
  if (existsSync(distWeb)) {
    cpSync(distWeb, distRoot, { recursive: true, force: true });
  }
}

runBuild().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
