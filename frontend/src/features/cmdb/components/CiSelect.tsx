'use client';

import { AsyncLookupSelect, type LookupSelectProps } from '@/components/forms';
import { useLookupQuery } from '@/hooks';
import { useCiLookup } from '../api/lookups';

export function CiSelect(props: LookupSelectProps) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useCiLookup(query, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}
