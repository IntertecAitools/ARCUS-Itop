import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  addIncidentLogEntry,
  createIncident,
  getIncident,
  getIncidentOptions,
  getIncidents,
  transitionIncident,
  updateIncident,
} from './incidents.api';
import type {
  CreateIncidentInput,
  IncidentDetail,
  IncidentFilters,
  TransitionInput,
  UpdateIncidentInput,
} from '../types';

export function useIncidents(filters: IncidentFilters) {
  return useQuery({
    queryKey: queryKeys.incidents.list(filters as unknown as Record<string, unknown>),
    queryFn: () => getIncidents(filters),
    // Keep the current page on screen while the next one loads, so paging and
    // filtering don't blank the table on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useIncident(id: string) {
  return useQuery({
    queryKey: queryKeys.incidents.detail(id),
    queryFn: () => getIncident(id),
    enabled: Boolean(id),
  });
}

export function useIncidentOptions() {
  return useQuery({
    queryKey: queryKeys.incidents.options(),
    queryFn: getIncidentOptions,
    // Organisations, agents and teams barely change; re-fetching them on every
    // form open costs a round trip to iTop for nothing.
    staleTime: 10 * 60_000,
  });
}

/**
 * Writes all funnel through here so cache invalidation happens in ONE place.
 *
 * Every mutation seeds the detail cache with the server's response and
 * invalidates the lists — a transition changes status, which changes which
 * filtered lists the incident belongs to, and the sidebar counts with it.
 */
function useIncidentMutation<TInput>(
  mutationFn: (input: TInput) => Promise<IncidentDetail>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (incident) => {
      queryClient.setQueryData(queryKeys.incidents.detail(incident.id), incident);
      queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.navCounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() });
    },
  });
}

export function useCreateIncident() {
  return useIncidentMutation((input: CreateIncidentInput) => createIncident(input));
}

export function useUpdateIncident(id: string) {
  return useIncidentMutation((input: UpdateIncidentInput) => updateIncident(id, input));
}

export function useTransitionIncident(id: string) {
  return useIncidentMutation((input: TransitionInput) => transitionIncident(id, input));
}

export function useAddLogEntry(id: string) {
  return useIncidentMutation((message: string) => addIncidentLogEntry(id, message));
}
