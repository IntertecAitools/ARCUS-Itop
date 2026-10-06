import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { ChangeOption } from '../types';

/** Open (not closed) Changes only, as iTop's related_change_id filter requires. */
export function useOpenChangeLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.changes(q),
    queryFn: ({ signal }) => apiClient.get<ChangeOption[]>('/changes', { query: { q, open: true }, signal }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
