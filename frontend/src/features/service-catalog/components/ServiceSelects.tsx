'use client';

import { AsyncLookupSelect, type LookupSelectProps } from '@/components/forms';
import { useLookupQuery } from '@/hooks';
import { useServiceLookup, useSubcategoryLookup } from '../api/lookups';

/** Services available to an organization (iTop filters by customer contract). */
export function ServiceSelect({ orgId, ...props }: LookupSelectProps & { orgId?: string }) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useServiceLookup(query, orgId, active);
  return <AsyncLookupSelect {...props} options={data ?? []} loading={isFetching} onSearch={setQuery} />;
}

/** Subcategories of the selected service; disabled until a service is chosen. */
export function SubcategorySelect({ serviceId, ...props }: LookupSelectProps & { serviceId?: string }) {
  const { query, setQuery, active } = useLookupQuery();
  const { data, isFetching } = useSubcategoryLookup(serviceId, query, active);
  return (
    <AsyncLookupSelect
      {...props}
      disabled={props.disabled || !serviceId}
      options={data ?? []}
      loading={isFetching}
      onSearch={setQuery}
    />
  );
}
