import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseProblemFilters, serializeProblemFilters } from '../schemas';
import type { ProblemFilters } from '../types';

/**
 * Problem list filters stored in URL search params (shareable, back-button friendly).
 * Changes apply to the UI immediately and are written to the URL; once the URL
 * catches up it is the source of truth again. Changing any filter other than
 * `page` resets to page 1.
 */
export function useProblemFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = params.toString();

  const urlFilters = useMemo(() => parseProblemFilters(new URLSearchParams(search)), [search]);
  const [pending, setPending] = useState<ProblemFilters | null>(null);
  const [seenSearch, setSeenSearch] = useState(search);
  if (search !== seenSearch) {
    setSeenSearch(search);
    setPending(null);
  }
  const filters = pending ?? urlFilters;

  const navigate = useCallback(
    (next: ProblemFilters) => {
      const qs = serializeProblemFilters(next).toString();
      setPending(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const setFilters = useCallback(
    (patch: Partial<ProblemFilters>) => navigate({ ...filters, ...patch, page: patch.page ?? 1 }),
    [filters, navigate],
  );

  /** Clear filters but keep the selected tab */
  const resetFilters = useCallback(
    () => navigate({ ...parseProblemFilters(new URLSearchParams()), tab: filters.tab }),
    [filters.tab, navigate],
  );

  return { filters, setFilters, resetFilters };
}
