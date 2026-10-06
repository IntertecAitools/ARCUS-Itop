import { apiClient } from '@/lib/api-client';
import type { IncidentDetail, IncidentFilters, IncidentListResult } from '../types';

const PAGE_SIZE = 25;

/**
 * Raw BFF calls for this feature. Components use the hooks, never this file.
 *
 * Array filters are sent comma-separated; the backend accepts that or repeated
 * params, but one shape keeps the query key — and the cache — predictable.
 */
export function getIncidents(filters: IncidentFilters) {
  return apiClient.get<IncidentListResult>('/incidents', {
    query: {
      page: filters.page,
      limit: PAGE_SIZE,
      q: filters.q,
      status: filters.status?.join(','),
      priority: filters.priority?.join(','),
      assignee: filters.assignee,
      sort: filters.sort,
      order: filters.order,
    },
  });
}

export function getIncident(id: string) {
  return apiClient.get<IncidentDetail>(`/incidents/${id}`);
}
