import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { ServiceOption, SubcategoryOption } from '../types';

export function useServiceLookup(q: string, orgId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.services(q, orgId),
    queryFn: ({ signal }) => apiClient.get<ServiceOption[]>('/services', { query: { q, orgId }, signal }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSubcategoryLookup(serviceId: string | undefined, q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.subcategories(serviceId ?? '', q),
    queryFn: ({ signal }) =>
      apiClient.get<SubcategoryOption[]>(`/services/${serviceId}/subcategories`, { query: { q }, signal }),
    enabled: enabled && !!serviceId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
