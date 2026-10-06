/**
 * Query-key factory.
 *
 * Every key is built here so invalidation is reliable: invalidating
 * `queryKeys.incidents.all()` is guaranteed to catch every incident query,
 * because no module can invent its own key shape.
 *
 * Convention: `[module, resource, …params]`. A new module adds one block.
 */
export const queryKeys = {
  navCounts: () => ['shell', 'nav-counts'] as const,

  dashboard: {
    all: () => ['dashboard'] as const,
    overview: (range: string) => ['dashboard', 'overview', range] as const,
  },

  incidents: {
    all: () => ['incidents'] as const,
    list: (filters: Record<string, unknown>) => ['incidents', 'list', filters] as const,
    detail: (id: string) => ['incidents', 'detail', id] as const,
  },

  userRequests: {
    all: () => ['user-requests'] as const,
    list: (filters: Record<string, unknown>) => ['user-requests', 'list', filters] as const,
    detail: (id: string) => ['user-requests', 'detail', id] as const,
  },
} as const;
