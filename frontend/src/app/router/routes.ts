/**
 * Route table. Path builders live in config/routes so features can use them
 * without importing the app shell; this file adds the metadata the shell needs.
 * Next.js file routing (src/app/**\/page.tsx) does the actual routing.
 */
import type { Permission } from '@/features/auth';

export { routes } from '@/config/routes';

export type LayoutKind = 'agent' | 'auth' | 'portal';

export interface RouteMeta {
  pattern: RegExp;
  layout: LayoutKind;
  /** Public routes skip RequireAuth */
  public?: boolean;
  /** Write permission needed to open the route (RequireRole) */
  permission?: Permission;
}

export const routeMeta: RouteMeta[] = [
  { pattern: /^\/login$/, layout: 'auth', public: true },
  { pattern: /^\/problems\/new$/, layout: 'agent', permission: 'problem:write' },
  { pattern: /^\/problems(\/.*)?$/, layout: 'agent' },
  { pattern: /^\/knowledge-base(\/.*)?$/, layout: 'agent' },
];

const fallback: RouteMeta = { pattern: /.*/, layout: 'agent' };

export function matchRoute(pathname: string): RouteMeta {
  return routeMeta.find((r) => r.pattern.test(pathname)) ?? fallback;
}
