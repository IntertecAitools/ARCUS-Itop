'use client';

import { AsyncLookupSelect, type LookupSelectProps } from '@/components/forms';
import { useLookupQuery } from '@/hooks';
import { useIncidentLookup } from '../api/lookups';

export function IncidentPicker(props: LookupSelectProps) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useIncidentLookup(query, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}
