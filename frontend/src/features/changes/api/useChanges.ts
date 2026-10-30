import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  createBlackout,
  deleteBlackout,
  getBlackouts,
  getCalendar,
  getPir,
  getPirQueue,
  getRisk,
  getRiskModel,
  savePir,
  saveRisk,
  saveRiskModel,
  updateBlackout,
  getCabQueue,
  getGovernance,
  getPlanRules,
  recordCabDecision,
  savePlanRules,
  savePlans,
} from './changes.api';
import type {
  BlackoutInput,
  CabDecisionInput,
  CalendarQuery,
  ChangeGovernance,
  ChangePlans,
  PirInput,
  PlanRules,
  RiskModel,
} from '../types';

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

export function useChangeCalendar(query: CalendarQuery) {
  return useQuery({
    queryKey: queryKeys.changes.calendar({ ...query }),
    queryFn: () => getCalendar(query),
    placeholderData: keepPreviousData,
  });
}

export function useBlackouts() {
  return useQuery({ queryKey: queryKeys.changes.blackouts(), queryFn: async () => (await getBlackouts()).items });
}

/** Blackouts show on the calendar: every write refreshes both. */
function useBlackoutWrite<A>(fn: (args: A) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.changes.blackouts() });
      queryClient.invalidateQueries({ queryKey: ['changes', 'calendar'] });
    },
  });
}

export const useCreateBlackout = () => useBlackoutWrite((input: BlackoutInput) => createBlackout(input));
export const useUpdateBlackout = () =>
  useBlackoutWrite(({ id, input }: { id: string; input: BlackoutInput }) => updateBlackout(id, input));
export const useDeleteBlackout = () => useBlackoutWrite((id: string) => deleteBlackout(id));

export function useChangeRisk(id: string) {
  return useQuery({ queryKey: queryKeys.changes.risk(id), queryFn: () => getRisk(id), enabled: Boolean(id) });
}

export function useSaveRisk(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, string>) => saveRisk(id, answers),
    onSuccess: (risk) => {
      queryClient.setQueryData(queryKeys.changes.risk(id), risk);
      queryClient.invalidateQueries({ queryKey: ['changes', 'calendar'] });
    },
  });
}

export function useRiskModel() {
  return useQuery({ queryKey: queryKeys.changes.riskModel(), queryFn: getRiskModel });
}

export function useSaveRiskModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (model: RiskModel) => saveRiskModel(model),
    onSuccess: (dto) => {
      queryClient.setQueryData(queryKeys.changes.riskModel(), dto);
      queryClient.invalidateQueries({ queryKey: ['changes', 'risk'] });
    },
  });
}

export function useChangePir(id: string) {
  return useQuery({ queryKey: queryKeys.changes.pir(id), queryFn: () => getPir(id), enabled: Boolean(id) });
}

export function useSavePir(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PirInput) => savePir(id, input),
    onSuccess: (pir) => {
      queryClient.setQueryData(queryKeys.changes.pir(id), pir);
      queryClient.invalidateQueries({ queryKey: queryKeys.changes.pirDue() });
    },
  });
}

export function usePirQueue() {
  return useQuery({ queryKey: queryKeys.changes.pirDue(), queryFn: getPirQueue });
}
