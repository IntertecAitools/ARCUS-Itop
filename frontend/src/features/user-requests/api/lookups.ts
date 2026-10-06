import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { LookupOption } from '@/types';

/** UserRequest typeahead (hint: status · org). */
export function useUserRequestLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.userRequests(q),
    queryFn: ({ signal }) => apiClient.get<LookupOption[]>('/user-requests', { query: { q }, signal }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
