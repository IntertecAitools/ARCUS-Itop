import { apiClient } from '@/lib/api-client';
import type {
  AnalysisSaveInput,
  CreateKnownErrorInput,
  KnownErrorCreated,
  ProblemAnalysis,
  ProblemTrends,
  RcaDraft,
  RcaEvidence,
  TrendQuery,
} from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

export function getAnalysis(id: string) {
  return apiClient.get<ProblemAnalysis>(`/problems/${id}/analysis`);
}

export function saveAnalysis(id: string, input: AnalysisSaveInput) {
  return apiClient.put<ProblemAnalysis>(`/problems/${id}/analysis`, input);
}

export function createKnownError(id: string, input: CreateKnownErrorInput) {
  return apiClient.post<KnownErrorCreated>(`/problems/${id}/known-errors`, input);
}

export function getTrends(query: TrendQuery) {
  return apiClient.get<ProblemTrends>('/problems/trends', {
    query: { period: query.period, groupBy: query.groupBy },
  });
}

export function getRcaEvidence(id: string, lookbackHours?: number) {
  return apiClient.get<RcaEvidence>(`/problems/${id}/rca-evidence`, {
    query: lookbackHours ? { lookbackHours: String(lookbackHours) } : {},
  });
}

export function draftRca(id: string, lookbackHours?: number) {
  return apiClient.post<RcaDraft>(`/problems/${id}/rca-draft`, lookbackHours ? { lookbackHours } : {});
}
