import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { NavEntry, Navigation } from '../types';

const getNavigation = () => apiClient.get<Navigation>('/meta/navigation');

/**
 * iTop's navigation tree.
 *
 * Cached for a long time on purpose: it only changes when a module is
 * installed in iTop, which means a setup run and a BFF restart. Refetching it
 * per screen would add a request to every navigation for data that is static
 * between deployments.
 */
export function useNavigation() {
  return useQuery({
    queryKey: ['navigation'],
    queryFn: getNavigation,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Where an entry points.
 *
 * All three kinds land on the generic record screens, which already read the
 * schema. A `list` entry carries its view id so the BFF applies iTop's filter;
 * `search` is the same screen without one, because the list has search built
 * in; `create` opens the new-record form.
 */
export function entryPath(entry: NavEntry): string {
  if (entry.kind === 'create') return `/records/${entry.class}/new`;
  if (entry.kind === 'list' && entry.filtered) {
    return `/records/${entry.class}?view=${encodeURIComponent(entry.id)}`;
  }
  return `/records/${entry.class}`;
}
