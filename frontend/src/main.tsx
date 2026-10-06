/**
 * Client bootstrap. In mock mode (NEXT_PUBLIC_API_MODE=mock) it starts the MSW
 * service worker, which plays the BFF, before the app renders.
 */
import { env } from '@/config/env';

let started: Promise<void> | null = null;

export function enableMocking(): Promise<void> {
  if (env.apiMode !== 'mock' || typeof window === 'undefined') return Promise.resolve();
  started ??= import('./mocks/browser')
    .then(({ worker }) =>
      worker.start({
        onUnhandledRequest: 'bypass',
        quiet: true,
        serviceWorker: { url: '/mockServiceWorker.js' },
      }),
    )
    .then(() => undefined);
  return started;
}
