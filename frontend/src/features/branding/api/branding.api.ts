import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { env } from '@/config/env';
import type { Branding } from '../types';

export const BRANDING_KEY = ['branding'] as const;

/**
 * The site's branding, asked for at app load (before sign-in: the sign-in
 * page wears it too). Null on the platform's own address. A failure keeps
 * the built-in look rather than blocking the app.
 */
export function useBranding() {
  return useQuery({
    queryKey: BRANDING_KEY,
    queryFn: async () => {
      try {
        return (await apiClient.get<{ branding: Branding | null }>('/branding')).branding;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** A logo path from the BFF as a URL the browser can load. */
export function logoSrc(logoUrl: string) {
  return `${env.bffUrl}${logoUrl}`;
}

/** What the header, sign-in and portal show as the product's name. */
export function useProductName() {
  const { data } = useBranding();
  return {
    custom: Boolean(data?.productName),
    full: data?.productName ?? `${env.appName} ${env.platformName}`,
    wordmark: data?.productName ?? env.appName,
    tagline: data?.productName ? undefined : env.platformName,
    logo: data?.logoUrl ? logoSrc(data.logoUrl) : undefined,
  };
}
