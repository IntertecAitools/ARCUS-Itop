import { apiClient } from '@/lib/api-client';
import type { AssignmentRules, AssignmentRulesDto, RoutingFacts, RuleTestResult, TakenTicket, TeamQueue, TicketType } from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

/** The pickers a rule needs: organisations, services, subcategories, teams. */
export interface RuleOptions {
  organizations: Array<{ value: string; label: string }>;
  services: Array<{ value: string; label: string }>;
  serviceSubcategories: Array<{ value: string; label: string; serviceId: string }>;
  teams: Array<{ value: string; label: string }>;
}

/** The incident form's options carry every picker a rule needs. */
export function getRuleOptions() {
  return apiClient.get<RuleOptions>('/incidents/options');
}

export function getTeamQueue() {
  return apiClient.get<TeamQueue>('/dispatch/queue');
}

export function takeTicket(type: TicketType, id: string) {
  return apiClient.post<TakenTicket>(`/dispatch/${type}/${id}/take`, {});
}

export function getAssignmentRules() {
  return apiClient.get<AssignmentRulesDto>('/admin/assignment-rules');
}

export function saveAssignmentRules(rules: AssignmentRules) {
  return apiClient.put<AssignmentRulesDto>('/admin/assignment-rules', rules);
}

export function testAssignmentRules(facts: RoutingFacts) {
  return apiClient.post<RuleTestResult>('/admin/assignment-rules/test', facts);
}
