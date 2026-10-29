import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  getAssignmentRules,
  getRuleOptions,
  getTeamQueue,
  saveAssignmentRules,
  takeTicket,
  testAssignmentRules,
} from './dispatch.api';
import type { AssignmentRules, AssignmentRulesDto, RoutingFacts, TicketType } from '../types';

/** Same request and cache as the incident form's options. */
export function useRuleOptions() {
  return useQuery({ queryKey: queryKeys.incidents.options(), queryFn: getRuleOptions, staleTime: 10 * 60_000 });
}

export function useTeamQueue() {
  return useQuery({
    queryKey: queryKeys.dispatch.queue(),
    queryFn: getTeamQueue,
    // A colleague may take a ticket at any moment; keep the queue fresh.
    refetchInterval: 60_000,
  });
}

/** Taking a ticket changes it, the queue, and every ticket list it is in. */
export function useTakeTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: TicketType; id: string }) => takeTicket(type, id),
    onSettled: (_taken, _error, { type, id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dispatch.queue() });
      queryClient.invalidateQueries({ queryKey: queryKeys.navCounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() });
      if (type === 'incident') {
        queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all() });
        queryClient.invalidateQueries({ queryKey: queryKeys.incidents.detail(id) });
      } else {
        queryClient.invalidateQueries({ queryKey: ['records'] });
      }
    },
  });
}

export function useAssignmentRules() {
  return useQuery({ queryKey: queryKeys.dispatch.rules(), queryFn: getAssignmentRules });
}

export function useSaveAssignmentRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: AssignmentRules) => saveAssignmentRules(rules),
    onSuccess: (saved: AssignmentRulesDto) => queryClient.setQueryData(queryKeys.dispatch.rules(), saved),
  });
}

export function useTestAssignmentRules() {
  return useMutation({ mutationFn: (facts: RoutingFacts) => testAssignmentRules(facts) });
}
