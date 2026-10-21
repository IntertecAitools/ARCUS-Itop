import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { mergeRun } from '../lib/runs';
import type {
  AuditCategoryForm,
  AuditDomain,
  AuditOptions,
  AuditOverview,
  AuditRuleForm,
  AuditRuns,
  CategoryInput,
  CategoryResult,
  DomainInput,
  RuleInput,
} from '../types';

const base = '/admin/audit';
const RUNS_KEY = ['admin', 'audit', 'runs'] as const;
const OVERVIEW_KEY = ['admin', 'audit', 'overview'] as const;

export function useAuditOverview() {
  return useQuery({
    queryKey: OVERVIEW_KEY,
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

// --- Editing -----------------------------------------------------------------

export function useAuditOptions() {
  return useQuery({
    queryKey: ['admin', 'audit', 'options'],
    queryFn: () => apiClient.get<AuditOptions>(`${base}/options`),
    staleTime: 30 * 60_000,
  });
}

export function useAuditCategory(id: string) {
  return useQuery({
    queryKey: ['admin', 'audit', 'category', id],
    queryFn: () => apiClient.get<AuditCategoryForm>(`${base}/categories/${id}`),
    enabled: Boolean(id) && id !== 'new',
  });
}

export function useAuditRule(id: string) {
  return useQuery({
    queryKey: ['admin', 'audit', 'rule', id],
    queryFn: () => apiClient.get<AuditRuleForm>(`${base}/rules/${id}`),
    enabled: Boolean(id) && id !== 'new',
  });
}

/**
 * After any change: the overview and the editors' copies are refetched, and
 * the results of earlier runs of the changed category are dropped, since they
 * no longer describe it.
 */
function useAfterChange() {
  const queryClient = useQueryClient();
  return (categoryId?: number) => {
    void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'audit', 'category'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'audit', 'rule'] });
    if (categoryId !== undefined) {
      queryClient.setQueryData<AuditRuns>(RUNS_KEY, (runs) => {
        if (!runs?.[categoryId]) return runs;
        const { [categoryId]: _dropped, ...rest } = runs;
        return rest;
      });
    }
  };
}

export function useSaveCategory(id: string) {
  const afterChange = useAfterChange();
  return useMutation({
    mutationFn: (input: CategoryInput) =>
      id === 'new'
        ? apiClient.post<AuditCategoryForm>(`${base}/categories`, input)
        : apiClient.put<AuditCategoryForm>(`${base}/categories/${id}`, input),
    onSuccess: (saved) => afterChange(saved.id),
  });
}

/** Deletes a category and, with it, its rules (the caller has said which). */
export function useDeleteCategory() {
  const afterChange = useAfterChange();
  return useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<{ deletedRules: Array<{ id: number; name: string }> }>(`${base}/categories/${id}`, {
        query: { withRules: 'true' },
      }),
    onSuccess: (_, id) => afterChange(id),
  });
}

export function useSaveRule(id: string) {
  const afterChange = useAfterChange();
  return useMutation({
    mutationFn: (input: RuleInput) =>
      id === 'new'
        ? apiClient.post<AuditRuleForm>(`${base}/rules`, input)
        : apiClient.put<AuditRuleForm>(`${base}/rules/${id}`, input),
    onSuccess: (saved) => afterChange(saved.categoryId),
  });
}

export function useDeleteRule() {
  const afterChange = useAfterChange();
  return useMutation({
    mutationFn: ({ id }: { id: number; categoryId: number }) => apiClient.delete<null>(`${base}/rules/${id}`),
    onSuccess: (_, { categoryId }) => afterChange(categoryId),
  });
}

export function useSaveDomain() {
  const afterChange = useAfterChange();
  return useMutation({
    mutationFn: ({ id, ...input }: DomainInput & { id?: number }) =>
      id === undefined
        ? apiClient.post<AuditDomain>(`${base}/domains`, input)
        : apiClient.put<AuditDomain>(`${base}/domains/${id}`, input),
    onSuccess: () => afterChange(),
  });
}

export function useDeleteDomain() {
  const afterChange = useAfterChange();
  return useMutation({
    mutationFn: (id: number) => apiClient.delete<null>(`${base}/domains/${id}`),
    onSuccess: () => afterChange(),
  });
}
