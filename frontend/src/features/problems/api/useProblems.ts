import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { createKnownError, getAnalysis, getTrends, saveAnalysis } from './problems.api';
import type { CreateKnownErrorInput, RootCauseAnalysis, TrendQuery } from '../types';

export function useProblemAnalysis(id: string) {
  return useQuery({
    queryKey: queryKeys.problems.analysis(id),
    queryFn: () => getAnalysis(id),
    enabled: Boolean(id),
  });
}

export function useSaveAnalysis(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RootCauseAnalysis) => saveAnalysis(id, input),
    onSuccess: (analysis) => {
      queryClient.setQueryData(queryKeys.problems.analysis(id), analysis);
      // The save is a private-log entry and a History line on the record.
      queryClient.invalidateQueries({ queryKey: ['records', 'Problem'] });
    },
  });
}

export function useCreateKnownError(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKnownErrorInput) => createKnownError(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.problems.analysis(id) });
      queryClient.invalidateQueries({ queryKey: ['records', 'Problem'] });
      queryClient.invalidateQueries({ queryKey: ['records', 'KnownError'] });
    },
  });
}

export function useProblemTrends(query: TrendQuery) {
  return useQuery({
    queryKey: queryKeys.problems.trends(query.period, query.groupBy),
    queryFn: () => getTrends(query),
    // Switching period or grouping keeps the last answer on screen meanwhile.
    placeholderData: (previous) => previous,
  });
}
