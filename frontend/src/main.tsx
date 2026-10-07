// Entry point: starts MSW when VITE_API_MODE=mock, then mounts <App />.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { env } from './config/env';
import './styles/globals.css';

/**
 * Removes a service worker left behind by an earlier `VITE_API_MODE=mock` run.
 *
 * MSW's worker is registered in the BROWSER, not the bundle, so it outlives the
 * session that started it. Switching to `live` without this leaves it happily
 * intercepting /api/* — the app shows mock data with a straight face, even with
 * the backend stopped. That is indistinguishable from "the backend is lying",
 * and costs an afternoon to track down.
 *
 * Unregistering is cheap and idempotent, so it runs on every live boot.
 */
async function stopStaleMocking() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const url = registration.active?.scriptURL ?? '';
      if (!url.includes('mockServiceWorker')) continue;
      await registration.unregister();
      console.warn(
        '[msw] removed a mock service worker left over from a previous ' +
          'VITE_API_MODE=mock session. Reload once to talk to the real backend.',
      );
    }
  } catch {
    // Unsupported or blocked: nothing was registered either, so nothing to do.
  }
}

/**
 * In mock mode the service worker must be running BEFORE React mounts,
 * otherwise the first queries race past it and hit the network.
 */
async function enableMocking() {
  if (!env.isMock) {
    await stopStaleMocking();
    return;
  }
  try {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  } catch (error) {
    // A blocked or unregistrable service worker must not leave a blank page —
    // mount anyway and let the queries surface their own error states.
    console.error('[msw] could not start the mock worker; continuing unmocked', error);
  }
}

enableMocking().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
