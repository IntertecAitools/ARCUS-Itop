import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { FormCatalogueService, FormField, FormScope, RequestFormDetail } from '../types';

const ADMIN_KEY = ['admin', 'request-forms'] as const;

/** Every service and subcategory, with how many questions each asks. */
export function useFormCatalogue() {
  return useQuery({
    queryKey: [...ADMIN_KEY, 'catalogue'],
    queryFn: async () =>
      (await apiClient.get<{ services: FormCatalogueService[] }>('/admin/request-forms')).services,
  });
}

export function useRequestForm(scope: FormScope, id: string) {
  return useQuery({
    queryKey: [...ADMIN_KEY, scope, id],
    queryFn: () => apiClient.get<RequestFormDetail>(`/admin/request-forms/${scope}/${id}`),
    enabled: Boolean(id),
  });
}

export function useSaveRequestForm(scope: FormScope, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: FormField[]) =>
      apiClient.put<RequestFormDetail>(`/admin/request-forms/${scope}/${id}`, { fields }),
    onSuccess: (detail) => {
      queryClient.setQueryData([...ADMIN_KEY, scope, id], detail);
      queryClient.invalidateQueries({ queryKey: [...ADMIN_KEY, 'catalogue'] });
      queryClient.invalidateQueries({ queryKey: ['request-form'] });
    },
  });
}

/**
 * The questions for a catalogue item, as staff (`/request-forms/resolve`) or
 * as an end user (`/portal/request-form`, inside their catalogue).
 */
export function useFormFor(audience: 'staff' | 'portal', serviceId?: number, subcategoryId?: number) {
  return useQuery({
    queryKey: ['request-form', audience, serviceId ?? 0, subcategoryId ?? 0],
    queryFn: async () =>
      (
        await apiClient.get<{ fields: FormField[] }>(
          audience === 'portal' ? '/portal/request-form' : '/request-forms/resolve',
          { query: { serviceId, subcategoryId } },
        )
      ).fields,
    enabled: Boolean(serviceId),
    staleTime: 60_000,
  });
}
