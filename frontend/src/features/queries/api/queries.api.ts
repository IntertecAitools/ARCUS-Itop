import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { saveBlob, type ExportFormat } from '@/features/records';
import { fileStem } from '../lib/queries';
import type { QueryInput, QueryOptions, QueryResult, SavedQuery } from '../types';

const base = '/queries';
const KEY = ['queries'] as const;
export const RESULTS_PAGE_SIZE = 25;

export function useSavedQueries() {
  return useQuery({ queryKey: [...KEY, 'list'], queryFn: () => apiClient.get<{ queries: SavedQuery[] }>(base) });
}

export function useSavedQuery(id: string) {
  return useQuery({
    queryKey: [...KEY, 'one', id],
    queryFn: () => apiClient.get<SavedQuery>(`${base}/${id}`),
    enabled: Boolean(id) && id !== 'new',
  });
}

export function useQueryOptions() {
  return useQuery({
    queryKey: [...KEY, 'options'],
    queryFn: () => apiClient.get<QueryOptions>(`${base}/options`),
    staleTime: 30 * 60_000,
  });
}

/** A page of a saved query's records, read with the signed-in user's rights. */
export function useQueryResults(id: number | undefined, page: number, fields: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'results', id, page, fields ?? ''],
    queryFn: () =>
      apiClient.get<QueryResult>(`${base}/${id}/results`, { query: { page, limit: RESULTS_PAGE_SIZE, fields } }),
    enabled: id !== undefined && fields !== undefined,
    placeholderData: (previous) => previous,
  });
}

/** Runs the query being edited, without saving it. */
export function useRunDraft() {
  return useMutation({
    mutationFn: ({ query, page, fields }: { query: QueryInput; page: number; fields?: string }) =>
      apiClient.post<QueryResult>(`${base}/run`, { query, page, limit: RESULTS_PAGE_SIZE, fields }),
  });
}

export function useSaveQuery(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QueryInput) =>
      id === 'new' ? apiClient.post<SavedQuery>(base, input) : apiClient.put<SavedQuery>(`${base}/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteQuery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiClient.delete<null>(`${base}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** Downloads a saved query's records as CSV / Excel / PDF. */
export function useExportQuery(query: Pick<SavedQuery, 'id' | 'name'>) {
  return useMutation({
    mutationFn: async ({ format, fields }: { format: ExportFormat; fields: string }) => {
      const blob = await apiClient.getBlob(`${base}/${query.id}/export`, { format, fields: fields || undefined });
      saveBlob(blob, `${fileStem(query.name)}-${new Date().toISOString().slice(0, 10)}.${format}`);
    },
  });
}
