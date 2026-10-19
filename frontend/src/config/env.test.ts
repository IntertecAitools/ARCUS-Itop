import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the api-mode default.
 *
 * This looks like a trivial fallback, but it decides what a developer sees on a
 * fresh clone: `.env` is gitignored, so `VITE_API_MODE` is genuinely absent
 * until someone copies the template. A `mock` default would serve invented
 * records that are indistinguishable from real ones — a failure nobody notices
 * because nothing looks broken. `live` fails visibly instead.
 */

async function loadEnv() {
  vi.resetModules();
  return (await import('./env')).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('api mode', () => {
  it('is live when VITE_API_MODE is absent', async () => {
    vi.stubEnv('VITE_API_MODE', undefined);

    const env = await loadEnv();

    expect(env.apiMode).toBe('live');
    expect(env.isMock).toBe(false);
  });

  it('is live when VITE_API_MODE is empty', async () => {
    // An empty value in a .env file is a common way to "unset" a variable.
    // Nullish coalescing would let `''` through, so it is handled explicitly.
    vi.stubEnv('VITE_API_MODE', '');

    const env = await loadEnv();

    expect(env.apiMode).toBe('live');
  });

  it('uses mocks only when asked explicitly', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock');

    const env = await loadEnv();

    expect(env.apiMode).toBe('mock');
    expect(env.isMock).toBe(true);
  });

  it('points at the BFF, never at iTop', async () => {
    vi.stubEnv('VITE_BFF_URL', undefined);

    const env = await loadEnv();

    // :4000 is the BFF. :8080 is iTop, which the frontend must never address.
    expect(env.bffUrl).toContain(':4000');
    expect(env.bffUrl).not.toContain(':8080');
  });
});
