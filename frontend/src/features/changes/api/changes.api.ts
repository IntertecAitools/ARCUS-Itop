import { apiClient } from '@/lib/api-client';
import type {
  CabDecisionInput,
  CabQueue,
  ChangeGovernance,
  ChangePlans,
  PlanRules,
  PlanRulesDto,
} from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

export function getGovernance(id: string) {
  return apiClient.get<ChangeGovernance>(`/changes/${id}/governance`);
}

export function savePlans(id: string, plans: Partial<ChangePlans>) {
  return apiClient.put<ChangeGovernance>(`/changes/${id}/plans`, plans);
}

export function recordCabDecision(id: string, input: CabDecisionInput) {
  return apiClient.post<ChangeGovernance>(`/changes/${id}/cab-decisions`, input);
}

export function getCabQueue() {
  return apiClient.get<CabQueue>('/changes/cab');
}

export function getPlanRules() {
  return apiClient.get<PlanRulesDto>('/admin/change-rules');
}

export function savePlanRules(rules: PlanRules) {
  return apiClient.put<PlanRulesDto>('/admin/change-rules', { rules });
}
