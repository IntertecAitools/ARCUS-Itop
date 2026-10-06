import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { LookupOption } from '@/types';

/** Incident typeahead (hint: status · org). */
export function useIncidentLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.incidents(q),
    queryFn: ({ signal }) => apiClient.get<LookupOption[]>('/incidents', { query: { q }, signal }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
