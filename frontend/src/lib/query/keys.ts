/**
 * The only place query keys are defined. Hierarchical, so invalidating a prefix
 * (e.g. qk.problems.all) refreshes every list, stat and detail beneath it.
 */
export const qk = {
  auth: {
    me: () => ['auth', 'me'] as const,
  },
  problems: {
    all: ['problems'] as const,
    lists: () => ['problems', 'list'] as const,
    list: (filters: object) => ['problems', 'list', filters] as const,
    allStats: () => ['problems', 'stats'] as const,
    stats: (range: string) => ['problems', 'stats', range] as const,
    detail: (id: string) => ['problems', 'detail', id] as const,
    transitions: (id: string) => ['problems', 'detail', id, 'transitions'] as const,
    attachments: (id: string) => ['problems', 'detail', id, 'attachments'] as const,
  },
  knownErrors: {
    all: ['known-errors'] as const,
    list: (filters: object) => ['known-errors', 'list', filters] as const,
    detail: (id: string) => ['known-errors', 'detail', id] as const,
    problemLookup: (q: string) => ['known-errors', 'problem-lookup', q] as const,
  },
  lookups: {
    orgs: (q: string) => ['lookups', 'orgs', q] as const,
    persons: (q: string, scope: object) => ['lookups', 'persons', q, scope] as const,
    teams: (q: string) => ['lookups', 'teams', q] as const,
    services: (q: string, orgId?: string) => ['lookups', 'services', q, orgId ?? null] as const,
    subcategories: (serviceId: string, q: string) => ['lookups', 'subcategories', serviceId, q] as const,
    cis: (q: string) => ['lookups', 'cis', q] as const,
    changes: (q: string) => ['lookups', 'changes', q] as const,
    incidents: (q: string) => ['lookups', 'incidents', q] as const,
    userRequests: (q: string) => ['lookups', 'user-requests', q] as const,
  },
} as const;
