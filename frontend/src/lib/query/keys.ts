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
    /**
     * Deliberately OUTSIDE the `incidents` root. Invalidation is prefix-based,
     * so `['incidents', 'options']` would be swept away by every write --
     * refetching organisations, agents, teams and services (four iTop calls)
     * after an action that cannot possibly have changed them.
     */
    options: () => ['incident-options'] as const,
  },

  problems: {
    all: () => ['problems'] as const,
    analysis: (id: string) => ['problems', 'analysis', id] as const,
    trends: (period: string, groupBy: string) => ['problems', 'trends', period, groupBy] as const,
  },

  sla: {
    all: () => ['sla'] as const,
    dashboard: (type: string) => ['sla', 'dashboard', type] as const,
    tickets: (query: object) => ['sla', 'tickets', query] as const,
  },

  changes: {
    all: () => ['changes'] as const,
    governance: (id: string) => ['changes', 'governance', id] as const,
    cab: () => ['changes', 'cab'] as const,
    rules: () => ['changes', 'rules'] as const,
  },

  approvals: {
    all: () => ['approvals'] as const,
    list: (state: string) => ['approvals', 'list', state] as const,
    count: () => ['approvals', 'count'] as const,
    detail: (id: string) => ['approvals', 'detail', id] as const,
    /** The approval shown with one request (staff or portal screens). */
    forRequest: (audience: 'staff' | 'portal', id: string) => ['approvals', 'request', audience, id] as const,
  },

  userRequests: {
    all: () => ['user-requests'] as const,
    list: (filters: Record<string, unknown>) => ['user-requests', 'list', filters] as const,
    detail: (id: string) => ['user-requests', 'detail', id] as const,
  },
} as const;
