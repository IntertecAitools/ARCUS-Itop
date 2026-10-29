import { apiClient } from '@/lib/api-client';
import type {
  Blackout,
  BlackoutInput,
  CabDecisionInput,
  CalendarQuery,
  ChangeCalendar,
  ChangePir,
  PirInput,
  PirQueue,
  RiskAssessment,
  RiskModel,
  RiskModelDto,
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

export function getCalendar(query: CalendarQuery) {
  return apiClient.get<ChangeCalendar>('/changes/calendar', { query: { ...query } });
}

export function getBlackouts() {
  return apiClient.get<{ items: Blackout[] }>('/admin/change-blackouts');
}

export function createBlackout(input: BlackoutInput) {
  return apiClient.post<Blackout>('/admin/change-blackouts', input);
}

export function updateBlackout(id: string, input: BlackoutInput) {
  return apiClient.put<Blackout>(`/admin/change-blackouts/${id}`, input);
}

export function deleteBlackout(id: string) {
  return apiClient.delete<void>(`/admin/change-blackouts/${id}`);
}

export function getRisk(id: string) {
  return apiClient.get<RiskAssessment>(`/changes/${id}/risk`);
}

export function saveRisk(id: string, answers: Record<string, string>) {
  return apiClient.put<RiskAssessment>(`/changes/${id}/risk`, { answers });
}

export function getRiskModel() {
  return apiClient.get<RiskModelDto>('/admin/change-risk');
}

export function saveRiskModel(model: RiskModel) {
  return apiClient.put<RiskModelDto>('/admin/change-risk', { model });
}

export function getPir(id: string) {
  return apiClient.get<ChangePir>(`/changes/${id}/pir`);
}

export function savePir(id: string, input: PirInput) {
  return apiClient.put<ChangePir>(`/changes/${id}/pir`, input);
}

export function getPirQueue() {
  return apiClient.get<PirQueue>('/changes/pir-due');
}
