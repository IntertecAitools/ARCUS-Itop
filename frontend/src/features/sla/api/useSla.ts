import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getDashboard, getTickets } from './sla.api';
import type { SlaTicketQuery, SlaTicketType } from '../types';

/** SLA states move with the clock, so both refresh every minute while on screen. */
const REFRESH_MS = 60_000;

export function useSlaDashboard(type: SlaTicketType) {
  return useQuery({
    queryKey: queryKeys.sla.dashboard(type),
    queryFn: () => getDashboard(type),
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function useSlaTickets(query: SlaTicketQuery, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sla.tickets(query),
    queryFn: () => getTickets(query),
    enabled,
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}
