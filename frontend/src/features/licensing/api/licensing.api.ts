import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/api-client';
import type { Edition, Feature, LicenceCheckResult, LicenceStatus } from '../types';

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

/**
 * The features this user's edition includes, when they are enforced; null
 * when nothing is hidden (licensing off or in warning mode, or not loaded
 * yet). The registry filters the sidebar, palette and routes with it.
 */
export function useEditionFeatures(): ReadonlySet<Feature> | null {
  const { data } = useLicenceStatus();
  return useMemo(() => (data && data.mode === 'enforce' ? new Set(data.features) : null), [data]);
}

/** The edition that includes a feature, from the status (null when unknown). */
export function useEditionFor(feature: Feature | undefined): { includedIn: string | null; current: string | null } {
  const { data } = useLicenceStatus();
  const edition = feature && data ? data.featureEditions[feature] : undefined;
  return { includedIn: edition ? EDITION_NAMES[edition] : null, current: data?.editionName ?? null };
}

const EDITION_NAMES: Record<Edition, string> = { ESS: 'Essentials', PRO: 'Professional', ENT: 'Enterprise' };

/** A BFF refusal because the edition does not include something: 403 LICENCE_FEATURE. */
export function licenceFeatureRefusal(error: unknown): { feature: Feature; includedIn: Edition | null } | null {
  if (!(error instanceof ApiError) || error.code !== 'LICENCE_FEATURE') return null;
  const d = (error.details ?? {}) as { feature?: Feature; includedIn?: Edition };
  return d.feature ? { feature: d.feature, includedIn: d.includedIn ?? null } : null;
}
