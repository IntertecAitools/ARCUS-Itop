/**
 * The one place that reads `import.meta.env`. Everything else imports `env`.
 */

type ApiMode = 'mock' | 'live';

const mode = (import.meta.env.VITE_API_MODE ?? 'mock') as ApiMode;

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
  bffUrl: import.meta.env.VITE_BFF_URL ?? 'http://localhost:4000/api',
  appName: import.meta.env.VITE_APP_NAME ?? 'Intertec',
  platformName: import.meta.env.VITE_PLATFORM_NAME ?? 'iTop',
  defaultLocale: import.meta.env.VITE_DEFAULT_LOCALE ?? 'en',
  isDev: import.meta.env.DEV,
};
