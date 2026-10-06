import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { LookupOption, Paginated } from '@/types';
import type { KnownError, KnownErrorFilters, KnownErrorInput, KnownErrorSummary } from '../types';

export function useKnownErrors(filters: KnownErrorFilters) {
  return useQuery({
    queryKey: qk.knownErrors.list(filters),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<KnownErrorSummary>>('/known-errors', {
        query: { ...filters },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useKnownError(id: string) {
  return useQuery({
    queryKey: qk.knownErrors.detail(id),
    queryFn: ({ signal }) => apiClient.get<KnownError>(`/known-errors/${id}`, { signal }),
  });
}

export function useCreateKnownError() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: KnownErrorInput) => apiClient.post<KnownError>('/known-errors', input),
    onSuccess: (created) => {
      queryClient.setQueryData(qk.knownErrors.detail(created.id), created);
      void queryClient.invalidateQueries({ queryKey: qk.knownErrors.all });
      // A known error appears in its problem's knownerrors_list and in the KPI.
      void queryClient.invalidateQueries({ queryKey: qk.problems.all });
    },
  });
}

export function useUpdateKnownError(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: KnownErrorInput) => apiClient.patch<KnownError>(`/known-errors/${id}`, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.knownErrors.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: qk.knownErrors.all });
      void queryClient.invalidateQueries({ queryKey: qk.problems.all });
    },
  });
}

/** Problem typeahead for linking a known error (uses the problems list endpoint). */
export function useProblemRefLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.knownErrors.problemLookup(q),
    queryFn: async ({ signal }) => {
      const page = await apiClient.get<Paginated<{ id: string; ref: string; title: string }>>('/problems', {
        query: { q, page: 1, pageSize: 10, sort: '-start_date' },
        signal,
      });
      return page.items.map<LookupOption>((p) => ({ id: p.id, label: p.ref, hint: p.title }));
    },
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
