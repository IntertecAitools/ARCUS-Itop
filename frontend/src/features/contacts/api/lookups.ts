import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query';
import type { LookupOption } from '@/types';
import type { PersonScope } from '../types';

const LOOKUP_STALE = 60_000;

export function useOrgLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.orgs(q),
    queryFn: ({ signal }) => apiClient.get<LookupOption[]>('/orgs', { query: { q }, signal }),
    enabled,
    staleTime: LOOKUP_STALE,
    placeholderData: keepPreviousData,
  });
}

export function usePersonLookup(q: string, scope: PersonScope = {}, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.persons(q, scope),
    queryFn: ({ signal }) =>
      apiClient.get<LookupOption[]>('/persons', { query: { q, orgId: scope.orgId, teamId: scope.teamId }, signal }),
    enabled,
    staleTime: LOOKUP_STALE,
    placeholderData: keepPreviousData,
  });
}

export function useTeamLookup(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.lookups.teams(q),
    queryFn: ({ signal }) => apiClient.get<LookupOption[]>('/teams', { query: { q }, signal }),
    enabled,
    staleTime: LOOKUP_STALE,
    placeholderData: keepPreviousData,
  });
}
