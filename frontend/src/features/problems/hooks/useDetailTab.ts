import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export const PROBLEM_DETAIL_TABS = [
  'details',
  'activity',
  'incidents',
  'requests',
  'cis',
  'contacts',
  'known-errors',
  'change',
  'attachments',
] as const;

export type ProblemDetailTab = (typeof PROBLEM_DETAIL_TABS)[number];

/** Selected detail tab, kept in ?tab= */
export function useDetailTab(): [ProblemDetailTab, (tab: ProblemDetailTab) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab');
  const tab = (PROBLEM_DETAIL_TABS as readonly string[]).includes(raw ?? '') ? (raw as ProblemDetailTab) : 'details';

  const setTab = useCallback(
    (next: ProblemDetailTab) => {
      const search = new URLSearchParams(params.toString());
      if (next === 'details') search.delete('tab');
      else search.set('tab', next);
      const qs = search.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return [tab, setTab];
}
