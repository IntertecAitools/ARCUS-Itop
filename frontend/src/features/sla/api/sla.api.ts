import { apiClient } from '@/lib/api-client';
import type { SlaDashboard, SlaTicketList, SlaTicketQuery, SlaTicketType } from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

export function getDashboard(type: SlaTicketType) {
  return apiClient.get<SlaDashboard>('/sla/dashboard', { query: { type } });
}

export function getTickets(query: SlaTicketQuery) {
  return apiClient.get<SlaTicketList>('/sla/tickets', {
    query: {
      type: query.type,
      state: query.state,
      team: query.team,
      priority: query.priority,
      org: query.org,
    },
  });
}
