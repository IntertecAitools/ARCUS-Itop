import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { rm } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

/**
 * Keeps MSW's service worker out of any build that isn't in mock mode.
 *
 * `public/mockServiceWorker.js` is copied verbatim into `dist/` by Vite, so a
 * live build would otherwise ship the one file capable of serving fabricated
 * data. A worker already registered in someone's browser outlives the build
 * that registered it, and will happily answer from that script — which is how
 * mock records kept reappearing in a "live" app.
 *
 * `stopStaleMocking()` in main.tsx unregisters it at boot; this removes the
 * script it would need. Belt and braces, because a silent wrong answer is the
 * worst failure this app has.
 */
function excludeMockWorker(isMock: boolean): Plugin {
  return {
    name: 'exclude-mock-worker',
    apply: 'build',
    async closeBundle() {
      if (isMock) return;
      await rm('dist/mockServiceWorker.js', { force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' loads every var, not just the VITE_-prefixed ones. Mirrors env.ts:
  // anything but an explicit `mock` means live.
  const isMock = loadEnv(mode, process.cwd(), '').VITE_API_MODE === 'mock';

  return {
  plugins: [react(), tailwindcss(), excludeMockWorker(isMock)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the slow-moving vendors out of the app chunk so a routine UI
        // change doesn't invalidate React and the charting library in cache.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          data: ['@tanstack/react-query', '@tanstack/react-table'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Only used when VITE_API_MODE=live and VITE_BFF_URL is left relative.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Unit tests live beside the code. `tests/` is Playwright's — Vitest would
    // otherwise try to run the e2e specs and fail on Playwright's test().
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  // Cast because `test` belongs to Vitest's config, not Vite's, and importing
  // vitest/config here would pull the test runner into the build.
  } as never;
});
