export type ApiMode = 'mock' | 'bff';

// NEXT_PUBLIC_* must be read with literal property access so Next.js can inline them.
const apiMode: ApiMode = process.env.NEXT_PUBLIC_API_MODE === 'bff' ? 'bff' : 'mock';

/** Mock mode uses a same-origin path that only MSW answers. */
export const MOCK_BFF_BASE = '/api/bff';

export const env = {
  apiMode,
  bffUrl: apiMode === 'bff' ? (process.env.NEXT_PUBLIC_BFF_URL ?? '/api') : MOCK_BFF_BASE,
} as const;
