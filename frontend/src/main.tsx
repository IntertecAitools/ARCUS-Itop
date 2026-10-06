// Entry point: starts MSW when VITE_API_MODE=mock, then mounts <App />.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { env } from './config/env';
import './styles/globals.css';

/**
 * In mock mode the service worker must be running BEFORE React mounts,
 * otherwise the first queries race past it and hit the network.
 */
async function enableMocking() {
  if (!env.isMock) return;
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
