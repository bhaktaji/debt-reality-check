import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      // The dashboard imports the SAME core module as the bot and the CLI (F-03).
      '@core': resolve(repoRoot, 'core'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // Allow importing ../core from outside the Vite root.
    fs: { allow: [repoRoot] },
  },
  // Relative asset paths: the bundle works from any static host, any subdirectory, or
  // straight from disk, which matches the offline-first intent.
  base: './',
  build: {
    outDir: resolve(repoRoot, 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
