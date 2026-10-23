import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query/keys';
import type { ApprovalDecision, ApprovalDetail, ApprovalList, RecordApproval } from '../types';

/**
 * The signed-in user's approvals. One API for staff and end users: the BFF
 * shows each only the approvals they are an approver on.
 */
export function useApprovals(state: 'pending' | 'decided') {
  return useQuery({
    queryKey: queryKeys.approvals.list(state),
    queryFn: () => apiClient.get<ApprovalList>('/me/approvals', { query: { state } }),
  });
}

/** How many wait for the user: the badge. Polled, like the bell. */
export function usePendingApprovalCount() {
  return useQuery({
    queryKey: queryKeys.approvals.count(),
    queryFn: async () => (await apiClient.get<{ pending: number }>('/me/approvals/count')).pending,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useApproval(id: string) {
  return useQuery({
    queryKey: queryKeys.approvals.detail(id),
    queryFn: () => apiClient.get<ApprovalDetail>(`/me/approvals/${id}`),
    enabled: Boolean(id),
  });
}

/** Approve or reject; answers with the approval as it now stands. */
export function useAnswerApproval(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ decision, comment }: { decision: ApprovalDecision; comment: string }) =>
      apiClient.post<ApprovalDetail>(`/me/approvals/${id}/${decision === 'approved' ? 'approve' : 'reject'}`, {
        comment,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.approvals.detail(id), detail);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.navCounts() });
    },
  });
}

/**
 * The approval on one user request, if it has been through one. Staff read
 * it for requests they can see; end users for their own (portal scope).
 */
export function useRequestApproval(audience: 'staff' | 'portal', requestId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.approvals.forRequest(audience, requestId),
    queryFn: async () =>
      (
        await apiClient.get<{ approval: RecordApproval | null }>(
          audience === 'staff' ? `/approvals/requests/${requestId}` : `/portal/requests/${requestId}/approval`,
        )
      ).approval,
    enabled: enabled && Boolean(requestId),
  });
}
