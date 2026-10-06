import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { LookupOption } from '@/types';

/** FunctionalCI typeahead; hint carries the CI class. */
export function useCiLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.cis(q),
    queryFn: ({ signal }) => apiClient.get<LookupOption[]>('/cis', { query: { q }, signal }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
