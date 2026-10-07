import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { statusLabel, priorityLabel } from '@/components/data-display';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/types/ticket';
import type { TicketPriority, TicketStatus } from '@/types/ticket';
import type { IncidentFilters } from '../types';

interface Props {
  filters: IncidentFilters;
  onChange: (patch: Partial<IncidentFilters>) => void;
  onClear: () => void;
  activeCount: number;
}

/**
 * One filter row above the table — never scattered per column, so there is
 * never a question about what the list is currently scoped to.
 */
export function IncidentFilterBar({ filters, onChange, onClear, activeCount }: Props) {
  const [search, setSearch] = useState(filters.q ?? '');

  // Keep the box in step when the URL changes from elsewhere (back button,
  // "clear filters"), without fighting the user mid-type.
  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);

  // Debounced, so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const current = filters.q ?? '';
    if (search === current) return;
    const timer = setTimeout(() => onChange({ q: search || undefined }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, onChange]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by reference or summary…"
        aria-label="Search incidents"
        leadingIcon={<Search className="size-4" />}
        className="w-full sm:w-80"
        trailing={
          search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="text-ink-muted transition-colors hover:text-ink"
            >
              <X className="size-4" />
            </button>
          ) : undefined
        }
      />

      <Select
        aria-label="Filter by status"
        className="w-40"
        value={filters.status?.[0] ?? ''}
        onChange={(e) =>
          onChange({ status: e.target.value ? [e.target.value as TicketStatus] : undefined })
        }
        options={[
          { value: '', label: 'All statuses' },
          ...TICKET_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
        ]}
      />

      <Select
        aria-label="Filter by priority"
        className="w-40"
        value={filters.priority?.[0] ?? ''}
        onChange={(e) =>
          onChange({ priority: e.target.value ? [e.target.value as TicketPriority] : undefined })
        }
        options={[
          { value: '', label: 'All priorities' },
          ...TICKET_PRIORITIES.map((priority) => ({
            value: priority,
            label: priorityLabel(priority),
          })),
        ]}
      />

      <Select
        aria-label="Filter by assignee"
        className="w-40"
        value={filters.assignee ?? ''}
        onChange={(e) => onChange({ assignee: e.target.value || undefined })}
        options={[
          { value: '', label: 'Anyone' },
          { value: 'unassigned', label: 'Unassigned' },
        ]}
      />

      {activeCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={onClear} leadingIcon={<X className="size-4" />}>
          Clear {activeCount === 1 ? 'filter' : `${activeCount} filters`}
        </Button>
      ) : null}
    </div>
  );
}
