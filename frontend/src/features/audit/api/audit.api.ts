import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { mergeRun } from '../lib/runs';
import type { AuditOverview, AuditRuns, CategoryResult } from '../types';

const base = '/admin/audit';
const RUNS_KEY = ['admin', 'audit', 'runs'] as const;

export function useAuditOverview() {
  return useQuery({
    queryKey: ['admin', 'audit', 'overview'],
    queryFn: () => apiClient.get<AuditOverview>(base),
  });
}

/**
 * Results of the runs so far, kept in the query cache so they survive a
 * look at a failing record and the way back.
 */
export function useAuditRuns() {
  return useQuery({
    queryKey: RUNS_KEY,
    queryFn: () => ({}) as AuditRuns,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
  });
}

export type RunTarget = { kind: 'category' | 'rule'; id: number };

export function useRunAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: RunTarget) =>
      apiClient.post<CategoryResult>(`${base}/${kind === 'category' ? 'categories' : 'rules'}/${id}/run`),
    onSuccess: (result, { kind }) => {
      queryClient.setQueryData<AuditRuns>(RUNS_KEY, (runs) => mergeRun(runs ?? {}, result, kind === 'category'));
    },
  });
}
