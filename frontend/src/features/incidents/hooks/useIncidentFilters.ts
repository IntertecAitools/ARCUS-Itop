import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/types/ticket';
import type { TicketPriority, TicketStatus } from '@/types/ticket';
import type { IncidentFilters, IncidentSort } from '../types';

const SORTS: IncidentSort[] = ['ref', 'title', 'status', 'priority', 'start_date'];

/** Reads a comma-separated param, keeping only values in our vocabulary. */
function readList<T extends string>(raw: string | null, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is T => (allowed as readonly string[]).includes(value));
  return values.length ? values : undefined;
}

/**
 * The incident queue's filters, kept in the URL.
 *
 * A filtered queue is then shareable, survives a reload and the back button,
 * and gives each distinct view its own query cache entry for free.
 */
export function useIncidentFilters() {
  const [params, setParams] = useSearchParams();

  const filters: IncidentFilters = useMemo(() => {
    const page = Number(params.get('page'));
    const sortRaw = params.get('sort');
    const orderRaw = params.get('order');

    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      q: params.get('q')?.trim() || undefined,
      status: readList<TicketStatus>(params.get('status'), TICKET_STATUSES),
      priority: readList<TicketPriority>(params.get('priority'), TICKET_PRIORITIES),
      assignee: params.get('assignee') || undefined,
      sort: SORTS.includes(sortRaw as IncidentSort) ? (sortRaw as IncidentSort) : undefined,
      order: orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : undefined,
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<IncidentFilters>) => {
      const next = new URLSearchParams(params);

      for (const [key, value] of Object.entries(patch)) {
        const serialised = Array.isArray(value) ? value.join(',') : value;
        if (serialised === undefined || serialised === '' || serialised === null) {
          next.delete(key);
        } else {
          next.set(key, String(serialised));
        }
      }

      // Any filter change invalidates the current page number — staying on
      // page 4 of a result set that now has one page shows an empty table.
      if (!('page' in patch)) next.delete('page');

      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const activeCount =
    (filters.q ? 1 : 0) +
    (filters.status?.length ? 1 : 0) +
    (filters.priority?.length ? 1 : 0) +
    (filters.assignee ? 1 : 0);

  return { filters, update, clear, activeCount };
}
