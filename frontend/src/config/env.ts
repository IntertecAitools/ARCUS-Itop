/**
 * The one place that reads `import.meta.env`. Everything else imports `env`.
 */

type ApiMode = 'mock' | 'live';

/**
 * Defaults to `live`, and that default is load-bearing.
 *
 * `.env` is gitignored, so a fresh clone has no `VITE_API_MODE` at all. If the
 * fallback were `mock`, a teammate's first `npm run dev` would serve fabricated
 * records that look exactly like real ones — the failure is silent, and it is
 * believed. Defaulting to `live` fails loudly instead: no BFF on :4000 means
 * visible errors, which is the correct thing to see when there is no backend.
 *
 * Mocks are therefore opt-in: set `VITE_API_MODE=mock` deliberately.
 *
 * `||` rather than `??` throughout this file: a bare `VITE_API_MODE=` line in a
 * .env yields `''`, which nullish coalescing would happily accept as the mode.
 * For every value here an empty string is meaningless, so it falls back too.
 */
const mode = (import.meta.env.VITE_API_MODE || 'live') as ApiMode;

interface Env {
  /** `mock` → MSW intercepts every call; `live` → the real BFF. */
  apiMode: ApiMode;
  isMock: boolean;
  bffUrl: string;
  appName: string;
  /** The system of record, shown under the wordmark. */
  platformName: string;
  defaultLocale: string;
  isDev: boolean;
}

export const env: Env = {
  apiMode: mode,
  isMock: mode === 'mock',
  bffUrl: import.meta.env.VITE_BFF_URL || 'http://localhost:4000/api',
  appName: import.meta.env.VITE_APP_NAME || 'Intertec',
  platformName: import.meta.env.VITE_PLATFORM_NAME || 'iTop',
  defaultLocale: import.meta.env.VITE_DEFAULT_LOCALE || 'en',
  isDev: import.meta.env.DEV,
};
