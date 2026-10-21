/**
 * Which stack the journeys run against, and where it lives.
 *
 *   E2E_TARGET=mock (default)  the MSW mock build; CI runs this
 *   E2E_TARGET=live            the BFF + local iTop + Mailpit
 *
 * The live ports default to ones no other local session uses (BFF :4600,
 * frontend :5673), so a run never lands on someone else's servers.
 */
export const TARGET: 'mock' | 'live' = process.env.E2E_TARGET === 'live' ? 'live' : 'mock';
export const isLive = TARGET === 'live';

/** Where the mock build is served. */
export const MOCK_URL = process.env.E2E_MOCK_URL ?? 'http://localhost:5674';

/** Live only: the frontend Playwright starts, the BFF it talks to, and Mailpit. */
export const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5673';
export const BFF_URL = process.env.E2E_BFF_URL ?? 'http://localhost:4600/api';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
