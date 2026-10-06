'use client';

import { useTranslation } from 'react-i18next';
import { Unlink } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { LinkedTicket } from '../types';
import { PriorityBadge, TicketStatusPill } from './TicketBadges';

export interface LinkedTicketTableProps {
  caption: string;
  tickets: LinkedTicket[];
  emptyTitle: string;
  emptyDescription?: string;
  /** Omit to hide the unlink column (read-only) */
  onUnlink?: (ticket: LinkedTicket) => void;
}

/** Linked Incidents / UserRequests of a ticket. */
export function LinkedTicketTable({ caption, tickets, emptyTitle, emptyDescription, onUnlink }: LinkedTicketTableProps) {
  const { t } = useTranslation('tickets');

  const columns: DataTableColumn<LinkedTicket>[] = [
    { id: 'ref', header: t('columns.ref'), cell: (r) => <span className="font-medium text-link">{r.ref}</span> },
    { id: 'title', header: t('columns.title'), cell: (r) => r.title },
    { id: 'priority', header: t('columns.priority'), cell: (r) => <PriorityBadge priority={r.priority} /> },
    { id: 'status', header: t('columns.status'), cell: (r) => <TicketStatusPill status={r.status} /> },
    { id: 'start_date', header: t('columns.created'), cell: (r) => formatDate(r.start_date) },
  ];
  if (onUnlink) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      hideable: false,
      className: 'w-24 text-right',
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onUnlink(r)}
          aria-label={t('unlinkTicket', { ref: r.ref })}
          leftIcon={<Unlink className="size-4" aria-hidden />}
        >
          {t('unlink')}
        </Button>
      ),
    });
  }

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={tickets}
      getRowId={(r) => r.id}
      emptyState={<EmptyState title={emptyTitle} description={emptyDescription} />}
    />
  );
}
