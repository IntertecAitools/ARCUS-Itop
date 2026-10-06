import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
} as never);
