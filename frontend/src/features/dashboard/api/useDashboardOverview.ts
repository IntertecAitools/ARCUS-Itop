import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getDashboardOverview } from './dashboard.api';
import type { DateRange } from '../types';

export function useDashboardOverview(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.overview(range),
    queryFn: () => getDashboardOverview(range),
    // Keep the previous window's data on screen while the new one loads, so
    // changing the range doesn't blank every card.
    placeholderData: (previous) => previous,
  });
}
