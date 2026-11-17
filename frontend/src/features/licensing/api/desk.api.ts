import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Edition, IssueLicenceInput, IssueLicenceResult, LicencesOverview, RegisterRow } from '../types';

const DESK_KEY = ['licence-desk'] as const;

/** The licence register and the renewals due. Platform operators only. */
export function useLicences(customer?: string) {
  return useQuery({
    queryKey: [...DESK_KEY, customer ?? ''],
    queryFn: () => apiClient.get<LicencesOverview>('/platform/licences', customer ? { query: { customer } } : undefined),
    retry: false,
  });
}

function useDeskMutation<I, O>(fn: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DESK_KEY });
      void queryClient.invalidateQueries({ queryKey: ['licence'] });
    },
  });
}

export const useIssueLicence = () => useDeskMutation((input: IssueLicenceInput) => apiClient.post<IssueLicenceResult>('/platform/licences', input));

export const useReissueLicence = () =>
  useDeskMutation(({ id, ...changes }: { id: string; reason: string; agents?: number; edition?: Edition }) =>
    apiClient.post<IssueLicenceResult>(`/platform/licences/${encodeURIComponent(id)}/reissue`, changes),
  );

export const useRevokeLicence = () =>
  useDeskMutation(({ id, reason }: { id: string; reason: string }) => apiClient.post<RegisterRow>(`/platform/licences/${encodeURIComponent(id)}/revoke`, { reason }));
