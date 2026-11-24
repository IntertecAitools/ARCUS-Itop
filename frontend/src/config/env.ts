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
  /** Shown under the wordmark ("Servicedesk"); empty for none. */
  platformName: string;
  /** The name and the line under it together: "Intertec Servicedesk", or "IRAOPS". */
  fullName: string;
  /** The company that issues licences ("Intertec"). */
  companyName: string;
  /** Which built-in logo the installation shows (components/layout/Logo). */
  brandMark: 'intertec' | 'iraops';
  defaultLocale: string;
  isDev: boolean;
}

/**
 * The installation's names, set on the web server when it starts rather than
 * compiled in, so one build runs under any name: nginx answers /config.js
 * from APP_NAME, PLATFORM_NAME, COMPANY_NAME and BRAND_MARK
 * (nginx/default.conf.template). Without it (development, tests) the file in
 * public/ is empty and the VITE_* values below apply.
 */
interface RuntimeConfig {
  appName?: string;
  platformName?: string;
  companyName?: string;
  brandMark?: string;
}

const runtime: RuntimeConfig =
  (typeof window !== 'undefined' && (window as { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__) || {};

const appName = runtime.appName || import.meta.env.VITE_APP_NAME || 'Intertec';
// An empty PLATFORM_NAME on the server means no line under the name.
const platformName = runtime.platformName ?? (import.meta.env.VITE_PLATFORM_NAME || 'Servicedesk');

export const env: Env = {
  apiMode: mode,
  isMock: mode === 'mock',
  bffUrl: import.meta.env.VITE_BFF_URL || 'http://localhost:4000/api',
  appName,
  platformName,
  fullName: [appName, platformName].filter(Boolean).join(' '),
  companyName: runtime.companyName || import.meta.env.VITE_COMPANY_NAME || 'Intertec',
  brandMark: (runtime.brandMark || import.meta.env.VITE_BRAND_MARK) === 'iraops' ? 'iraops' : 'intertec',
  defaultLocale: import.meta.env.VITE_DEFAULT_LOCALE || 'en',
  isDev: import.meta.env.DEV,
};
