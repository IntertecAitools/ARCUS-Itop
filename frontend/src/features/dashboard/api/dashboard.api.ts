import { apiClient } from '@/lib/api-client';
import type { DashboardOverview, DateRange } from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */
export function getDashboardOverview(range: DateRange) {
  return apiClient.get<DashboardOverview>('/dashboard/overview', { query: { range } });
}
