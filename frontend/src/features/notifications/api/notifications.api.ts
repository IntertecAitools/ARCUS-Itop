import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { EmailStatus, Rule, RuleInput, RuleOptions, SentEmail } from '../types';

const base = '/admin/notifications';
const RULES_KEY = ['admin', 'notifications', 'rules'] as const;

export function useRules() {
  return useQuery({
    queryKey: RULES_KEY,
    queryFn: async () => (await apiClient.get<{ rules: Rule[] }>(`${base}/rules`)).rules,
  });
}

export function useRule(id: string) {
  return useQuery({
    queryKey: [...RULES_KEY, id],
    queryFn: () => apiClient.get<Rule>(`${base}/rules/${id}`),
    enabled: Boolean(id) && id !== 'new',
  });
}

/** Record types, and for one of them its statuses, fields, SLA timers, roles and text fields. */
export function useRuleOptions(recordType?: string) {
  return useQuery({
    queryKey: ['admin', 'notifications', 'options', recordType ?? ''],
    queryFn: () =>
      apiClient.get<RuleOptions>(`${base}/options`, { query: { recordType: recordType || undefined } }),
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useSentEmails(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'notifications', 'sent'],
    queryFn: async () => (await apiClient.get<{ sent: SentEmail[] }>(`${base}/sent`)).sent,
    enabled,
  });
}

function useInvalidateRules() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: RULES_KEY });
}

export function useSaveRule(id: string) {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (input: RuleInput) =>
      id === 'new'
        ? apiClient.post<Rule>(`${base}/rules`, input)
        : apiClient.put<Rule>(`${base}/rules/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useSetRuleStatus() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: EmailStatus }) =>
      apiClient.patch<Rule>(`${base}/rules/${id}/status`, { status }),
    onSuccess: invalidate,
  });
}

export function useDeleteRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (id: number) => apiClient.delete<null>(`${base}/rules/${id}`),
    onSuccess: invalidate,
  });
}
