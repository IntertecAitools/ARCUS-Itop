import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  getCabQueue,
  getGovernance,
  getPlanRules,
  recordCabDecision,
  savePlanRules,
  savePlans,
} from './changes.api';
import type { CabDecisionInput, ChangeGovernance, ChangePlans, PlanRules } from '../types';

export function useChangeGovernance(id: string) {
  return useQuery({
    queryKey: queryKeys.changes.governance(id),
    queryFn: () => getGovernance(id),
    enabled: Boolean(id),
  });
}

/** A save or a decision changes the record itself (status, History) and the CAB queue. */
function useRefreshAfter(id: string) {
  const queryClient = useQueryClient();
  return (governance: ChangeGovernance) => {
    queryClient.setQueryData(queryKeys.changes.governance(id), governance);
    queryClient.invalidateQueries({ queryKey: queryKeys.changes.cab() });
    queryClient.invalidateQueries({ queryKey: ['records'] });
  };
}

export function useSavePlans(id: string) {
  const refresh = useRefreshAfter(id);
  return useMutation({
    mutationFn: (plans: Partial<ChangePlans>) => savePlans(id, plans),
    onSuccess: refresh,
  });
}

export function useRecordCabDecision(id: string) {
  const refresh = useRefreshAfter(id);
  return useMutation({
    mutationFn: (input: CabDecisionInput) => recordCabDecision(id, input),
    onSuccess: refresh,
  });
}

export function useCabQueue() {
  return useQuery({ queryKey: queryKeys.changes.cab(), queryFn: getCabQueue });
}

export function usePlanRules() {
  return useQuery({ queryKey: queryKeys.changes.rules(), queryFn: getPlanRules });
}

export function useSavePlanRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: PlanRules) => savePlanRules(rules),
    onSuccess: (dto) => {
      queryClient.setQueryData(queryKeys.changes.rules(), dto);
      // Every change's "missing plans" follows the rules.
      queryClient.invalidateQueries({ queryKey: queryKeys.changes.all() });
    },
  });
}
