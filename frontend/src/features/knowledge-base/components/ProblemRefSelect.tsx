'use client';

import { AsyncLookupSelect, type LookupSelectProps } from '@/components/forms';
import { useLookupQuery } from '@/hooks';
import { useProblemRefLookup } from '../api/knownErrors';

export function ProblemRefSelect(props: LookupSelectProps) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useProblemRefLookup(query, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}
