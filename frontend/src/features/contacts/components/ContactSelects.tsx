'use client';

import { AsyncLookupSelect, type LookupSelectProps } from '@/components/forms';
import { useLookupQuery } from '@/hooks';
import { useOrgLookup, usePersonLookup, useTeamLookup } from '../api/lookups';
import type { PersonScope } from '../types';

export function OrgSelect(props: LookupSelectProps) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useOrgLookup(query, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}

/** Person typeahead; scope it to an org (callers) or a team (agents) like iTop does. */
export function PersonSelect({ scope, ...props }: LookupSelectProps & { scope?: PersonScope }) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = usePersonLookup(query, scope, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}

export function TeamSelect(props: LookupSelectProps) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useTeamLookup(query, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}
