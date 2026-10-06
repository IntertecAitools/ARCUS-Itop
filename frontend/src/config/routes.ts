/**
 * Typed route paths. Lives in config/ so shared code and features can build links
 * without importing the app shell; app/router re-exports it with route metadata.
 */
type Params = Record<string, string | number | undefined | null>;

function withQuery(path: string, params?: Params): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export const routes = {
  home: '/',
  login: (next?: string) => withQuery('/login', { next }),
  dashboard: '/dashboard',
  problems: {
    dashboard: '/problems',
    list: (params?: Params) => withQuery('/problems/list', params),
    new: '/problems/new',
    detail: (id: string, tab?: string) => withQuery(`/problems/${id}`, { tab }),
  },
  knownErrors: {
    list: (params?: Params) => withQuery('/knowledge-base/known-errors', params),
    detail: (id: string) => `/knowledge-base/known-errors/${id}`,
  },
} as const;
