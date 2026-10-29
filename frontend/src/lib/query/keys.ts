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
    rcaEvidence: (id: string, lookbackHours: number) => ['problems', 'rca-evidence', id, lookbackHours] as const,
    trends: (period: string, groupBy: string) => ['problems', 'trends', period, groupBy] as const,
  },

  sla: {
    all: () => ['sla'] as const,
    dashboard: (type: string) => ['sla', 'dashboard', type] as const,
    tickets: (query: object) => ['sla', 'tickets', query] as const,
    businessHours: () => ['sla', 'business-hours'] as const,
  },

  dataImport: {
    classes: () => ['data-import', 'classes'] as const,
    reports: () => ['data-import', 'reports'] as const,
    report: (id: string) => ['data-import', 'reports', id] as const,
    sources: () => ['data-import', 'sources'] as const,
    source: (id: string) => ['data-import', 'sources', id] as const,
    log: (id: string, logId: number) => ['data-import', 'sources', id, 'logs', logId] as const,
  },

  changes: {
    all: () => ['changes'] as const,
    governance: (id: string) => ['changes', 'governance', id] as const,
    cab: () => ['changes', 'cab'] as const,
    rules: () => ['changes', 'rules'] as const,
    calendar: (filters: Record<string, unknown>) => ['changes', 'calendar', filters] as const,
    risk: (id: string) => ['changes', 'risk', id] as const,
    riskModel: () => ['changes', 'risk-model'] as const,
    blackouts: () => ['changes', 'blackouts'] as const,
    pir: (id: string) => ['changes', 'pir', id] as const,
    pirDue: () => ['changes', 'pir-due'] as const,
  },

  knowledge: {
    all: () => ['knowledge'] as const,
    list: (filters: Record<string, unknown>) => ['knowledge', 'list', filters] as const,
    article: (kind: string, id: string) => ['knowledge', 'article', kind, id] as const,
    settings: () => ['knowledge', 'settings'] as const,
  },

  dispatch: {
    all: () => ['dispatch'] as const,
    queue: () => ['dispatch', 'queue'] as const,
    rules: () => ['dispatch', 'rules'] as const,
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

  ticketHandling: {
    all: () => ['ticket-handling'] as const,
    summary: (cls: string, id: string) => ['ticket-handling', 'summary', cls, id] as const,
    worklog: (cls: string, id: string) => ['ticket-handling', 'worklog', cls, id] as const,
    suggestions: (query: object) => ['ticket-handling', 'suggestions', query] as const,
    report: (query: object) => ['ticket-handling', 'report', query] as const,
    drafts: (kind?: string) => ['ticket-handling', 'drafts', kind ?? 'all'] as const,
    draft: (id: string) => ['ticket-handling', 'draft', id] as const,
  },
} as const;
