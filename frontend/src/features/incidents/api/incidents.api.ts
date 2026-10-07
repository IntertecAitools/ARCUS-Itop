import { apiClient } from '@/lib/api-client';
import type {
  CreateIncidentInput,
  PersonOption,
  IncidentDetail,
  IncidentFilters,
  IncidentListResult,
  IncidentOptions,
  TransitionInput,
  UpdateIncidentInput,
} from '../types';

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

/** Pickers for the create/edit forms, in one request. */
export function getIncidentOptions() {
  return apiClient.get<IncidentOptions>('/incidents/options');
}

export function createIncident(input: CreateIncidentInput) {
  return apiClient.post<IncidentDetail>('/incidents', input);
}

export function updateIncident(id: string, input: UpdateIncidentInput) {
  return apiClient.patch<IncidentDetail>(`/incidents/${id}`, input);
}

/** Applies a lifecycle action: assign, reassign, hold, resolve, close, reopen. */
export function transitionIncident(id: string, input: TransitionInput) {
  return apiClient.post<IncidentDetail>(`/incidents/${id}/transitions`, input);
}

export function addIncidentLogEntry(id: string, message: string) {
  return apiClient.post<IncidentDetail>(`/incidents/${id}/log`, { message });
}

/**
 * Contacts belonging to one customer.
 *
 * Scoped deliberately: listing every person in the instance would offer
 * callers who do not work for the selected company.
 */
export function getPeopleByOrganization(organizationId: string) {
  return apiClient.get<{ items: PersonOption[] }>('/people', {
    query: { organizationId, limit: 200 },
  });
}
