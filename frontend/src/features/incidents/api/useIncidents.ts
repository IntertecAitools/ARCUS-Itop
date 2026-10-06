import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getIncident, getIncidents } from './incidents.api';
import type { IncidentFilters } from '../types';

export function useIncidents(filters: IncidentFilters) {
  return useQuery({
    queryKey: queryKeys.incidents.list(filters as unknown as Record<string, unknown>),
    queryFn: () => getIncidents(filters),
    // Keep the current page on screen while the next one loads, so paging and
    // filtering don't blank the table on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useIncident(id: string) {
  return useQuery({
    queryKey: queryKeys.incidents.detail(id),
    queryFn: () => getIncident(id),
    enabled: Boolean(id),
  });
}
