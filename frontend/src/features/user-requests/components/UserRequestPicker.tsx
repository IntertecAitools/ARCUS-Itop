'use client';

import { AsyncLookupSelect, type LookupSelectProps } from '@/components/forms';
import { useLookupQuery } from '@/hooks';
import { useUserRequestLookup } from '../api/lookups';

export function UserRequestPicker(props: LookupSelectProps) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useUserRequestLookup(query, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}
