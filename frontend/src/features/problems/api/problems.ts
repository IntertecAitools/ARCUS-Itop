import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type QueryParams } from '@/lib/api-client';
import { qk } from '@/lib/query';
import { useSessionStore } from '@/stores';
import type { Paginated } from '@/types';
import type {
  AttachmentContents,
  Problem,
  ProblemAttachment,
  ProblemCreateInput,
  ProblemStats,
  ProblemStimulus,
  ProblemSummary,
  ProblemTransition,
  ProblemUpdateInput,
  StatsRange,
  TransitionInput,
} from '../types';

// ─── Queries ─────────────────────────────────────────────────────────────────

export function fetchProblems(query: QueryParams, signal?: AbortSignal) {
  return apiClient.get<Paginated<ProblemSummary>>('/problems', { query, signal });
}

export function useProblems(query: QueryParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.problems.list(query),
    queryFn: ({ signal }) => fetchProblems(query, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useProblemStats(range: StatsRange) {
  return useQuery({
    queryKey: qk.problems.stats(range),
    queryFn: ({ signal }) => apiClient.get<ProblemStats>('/problems/stats', { query: { range }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProblem(id: string) {
  return useQuery({
    queryKey: qk.problems.detail(id),
    queryFn: ({ signal }) => apiClient.get<Problem>(`/problems/${id}`, { signal }),
  });
}

export function useProblemTransitions(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.problems.transitions(id),
    queryFn: ({ signal }) => apiClient.get<ProblemTransition[]>(`/problems/${id}/transitions`, { signal }),
    enabled,
  });
}

export function useProblemAttachments(id: string) {
  return useQuery({
    queryKey: qk.problems.attachments(id),
    queryFn: ({ signal }) => apiClient.get<ProblemAttachment[]>(`/problems/${id}/attachments`, { signal }),
  });
}

export function fetchAttachmentContents(problemId: string, attachmentId: string) {
  return apiClient.get<AttachmentContents>(`/problems/${problemId}/attachments/${attachmentId}`);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Refresh one problem (detail, transitions, attachments) and every list / stat. */
function useInvalidateProblem() {
  const queryClient = useQueryClient();
  return (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.problems.detail(id) }),
      queryClient.invalidateQueries({ queryKey: qk.problems.lists() }),
      queryClient.invalidateQueries({ queryKey: qk.problems.allStats() }),
    ]);
}

export function useCreateProblem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProblemCreateInput) => apiClient.post<Problem>('/problems', input),
    onSuccess: (created) => {
      queryClient.setQueryData(qk.problems.detail(created.id), created);
      void queryClient.invalidateQueries({ queryKey: qk.problems.all });
    },
  });
}

/** PATCH with an optimistic update of the cached detail; rolled back on error. */
export function useUpdateProblem(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProblem();
  return useMutation({
    mutationFn: (input: ProblemUpdateInput) => apiClient.patch<Problem>(`/problems/${id}`, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: qk.problems.detail(id) });
      const previous = queryClient.getQueryData<Problem>(qk.problems.detail(id));
      if (previous) queryClient.setQueryData<Problem>(qk.problems.detail(id), { ...previous, ...input });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(qk.problems.detail(id), context.previous);
    },
    onSuccess: (updated) => queryClient.setQueryData(qk.problems.detail(id), updated),
    onSettled: () => invalidate(id),
  });
}

export function useApplyStimulus(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProblem();
  return useMutation({
    mutationFn: ({ stimulus, input }: { stimulus: ProblemStimulus; input: TransitionInput }) =>
      apiClient.post<Problem>(`/problems/${id}/transitions/${stimulus}`, input),
    onSuccess: (updated) => queryClient.setQueryData(qk.problems.detail(id), updated),
    onSettled: () => invalidate(id),
  });
}

/** Add a private_log entry; shown immediately, replaced by the server copy. */
export function useAddLogEntry(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => apiClient.post<Problem>(`/problems/${id}/log`, { message }),
    onMutate: async (message) => {
      await queryClient.cancelQueries({ queryKey: qk.problems.detail(id) });
      const previous = queryClient.getQueryData<Problem>(qk.problems.detail(id));
      const user = useSessionStore.getState().user;
      if (previous) {
        queryClient.setQueryData<Problem>(qk.problems.detail(id), {
          ...previous,
          private_log: [
            ...previous.private_log,
            {
              date: new Date().toISOString(),
              user_login: user?.login ?? '',
              user_name: user?.name,
              message_html: message,
            },
          ],
        });
      }
      return { previous };
    },
    onError: (_error, _message, context) => {
      if (context?.previous) queryClient.setQueryData(qk.problems.detail(id), context.previous);
    },
    onSuccess: (updated) => queryClient.setQueryData(qk.problems.detail(id), updated),
  });
}

export type LinkKind = 'incidents' | 'requests' | 'cis' | 'contacts';

/** Link / unlink Incidents, UserRequests (parent_problem_id), CIs and contacts. */
export function useProblemLink(id: string, kind: LinkKind) {
  const invalidate = useInvalidateProblem();
  const link = useMutation({
    mutationFn: (targetId: string) => apiClient.post<void>(`/problems/${id}/${kind}`, { id: targetId }),
    onSettled: () => invalidate(id),
  });
  const unlink = useMutation({
    mutationFn: (targetId: string) => apiClient.delete(`/problems/${id}/${kind}/${targetId}`),
    onSettled: () => invalidate(id),
  });
  return { link, unlink };
}

export function useSetRelatedChange(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProblem();
  return useMutation({
    mutationFn: (changeId: string | null) => apiClient.put<Problem>(`/problems/${id}/change`, { changeId }),
    onSuccess: (updated) => queryClient.setQueryData(qk.problems.detail(id), updated),
    onSettled: () => invalidate(id),
  });
}

export function useUploadAttachment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contents: AttachmentContents) =>
      apiClient.post<ProblemAttachment>(`/problems/${id}/attachments`, contents),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.problems.attachments(id) }),
  });
}

export function useDeleteAttachment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => apiClient.delete(`/problems/${id}/attachments/${attachmentId}`),
    onMutate: async (attachmentId) => {
      await queryClient.cancelQueries({ queryKey: qk.problems.attachments(id) });
      const previous = queryClient.getQueryData<ProblemAttachment[]>(qk.problems.attachments(id));
      queryClient.setQueryData<ProblemAttachment[]>(
        qk.problems.attachments(id),
        (list) => list?.filter((a) => a.id !== attachmentId) ?? [],
      );
      return { previous };
    },
    onError: (_error, _attachmentId, context) => {
      if (context?.previous) queryClient.setQueryData(qk.problems.attachments(id), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.problems.attachments(id) }),
  });
}
