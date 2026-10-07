import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query/keys';
import type { NavCounts } from '@/components/layout/Sidebar';

/**
 * The badge numbers on the sidebar.
 *
 * Deliberately ONE request for all modules rather than one per module — the
 * shell must not fan out a dozen calls on every page load. Each module keeps
 * owning its own detailed queries; this is only the headline count.
 */
export function useNavCounts() {
  return useQuery({
    queryKey: queryKeys.navCounts(),
    queryFn: () => apiClient.get<NavCounts>('/nav/counts'),
    staleTime: 60_000,
  });
}
