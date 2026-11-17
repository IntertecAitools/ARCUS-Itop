import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/api-client';
import type { LicenceCheckResult, LicenceStatus } from '../types';

export const LICENCE_STATUS_KEY = ['licence', 'status'] as const;

/**
 * The licence status for the signed-in user: edition, features, state and
 * banners. Read at start and every minute, so a new key shows within one.
 * Null when licensing is off (the BFF has no licence routes then): the app
 * behaves as before, with every module and no banner.
 */
export function useLicenceStatus(enabled = true) {
  return useQuery({
    queryKey: LICENCE_STATUS_KEY,
    queryFn: async (): Promise<LicenceStatus | null> => {
      try {
        return await apiClient.get<LicenceStatus>('/licence/status');
      } catch (err) {
        if (err instanceof ApiError && err.isNotFound) return null;
        throw err;
      }
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** Checks a key without saving it: what it grants and what would change. */
export function useCheckLicence() {
  return useMutation({
    mutationFn: (text: string) => apiClient.post<LicenceCheckResult>('/licence/check', { text }),
  });
}

/** Saves a checked key; the status is re-read at once. */
export function useInstallLicence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; confirmOlder?: boolean }) => apiClient.put<LicenceCheckResult>('/licence', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['licence'] }),
  });
}
