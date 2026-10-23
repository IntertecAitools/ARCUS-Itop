import { apiClient } from '@/lib/api-client';
import type {
  CreateKnownErrorInput,
  KnownErrorCreated,
  ProblemAnalysis,
  ProblemTrends,
  RootCauseAnalysis,
  TrendQuery,
} from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

export function getAnalysis(id: string) {
  return apiClient.get<ProblemAnalysis>(`/problems/${id}/analysis`);
}

export function saveAnalysis(id: string, input: RootCauseAnalysis) {
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
