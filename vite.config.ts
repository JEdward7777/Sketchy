import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = resolve(import.meta.dirname, 'src/client');
const SHELL_ASSETS_TOKEN = '__SHELL_ASSETS__';

/**
 * Writes the build's hashed /assets/ files into sw.js as the precache list,
 * so the shell opens offline after one visit. The list carries content
 * hashes, so sw.js changes with every build and browsers pick up the update.
 * Fails the build if the token is missing rather than ship a worker that
 * precaches nothing.
 */
function shellAssetsPlugin(): Plugin {
  return {
    name: 'sketchy-shell-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/'))
        .sort()
        .map((file) => `/${file}`);
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk' || !sw.code.includes(SHELL_ASSETS_TOKEN)) {
        this.error(`sw.js is missing or has no ${SHELL_ASSETS_TOKEN} placeholder`);
      }
      sw.code = sw.code.replaceAll(SHELL_ASSETS_TOKEN, JSON.stringify(assets));
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), shellAssetsPlugin()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: resolve(root, 'index.html'),
        // The service worker is its own entry so it can import the pure
        // fetch policy, and it lands at /sw.js: a worker's scope is its own
        // directory, and the shell is served from /. Only sw.ts may import
        // sw-policy.ts: if the page imported it too, the bundler would split it
        // into a shared chunk and sw.js would stop being self-contained.
        sw: resolve(root, 'sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    // `vite` for UI work, `wrangler dev` (8787) for the Worker and rooms.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787' },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
