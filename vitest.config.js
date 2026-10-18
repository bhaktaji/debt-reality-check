import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));

// Vitest writes a module cache into the OS temp directory. In a locked-down sandbox that
// write can fail with EPERM and silently drop whole test files from the run, so redirect
// the temp directory into the project before Vitest reads it.
const tmp = resolve(root, '.vitest-tmp');
mkdirSync(tmp, { recursive: true });
process.env.TMPDIR = tmp;
process.env.TMP = tmp;
process.env.TEMP = tmp;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@core': resolve(root, 'core') },
  },
  // Keep every cache inside the project. The OS temp directory is not writable in all
  // sandboxes, and a failed cache write silently drops test files from the run.
  cacheDir: resolve(root, '.vitest-cache'),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
    reporters: 'default',
    // No test needs WhatsApp credentials, a network connection or a real clock.
    testTimeout: 20000,
  },
});
