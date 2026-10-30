import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { dateTimeText } from '@/lib/utils';
import { usePirQueue } from '../api/useChanges';
import { STATUS_LABEL, TYPE_TONE } from '../lib/calendar';
import { TYPE_LABEL } from '../lib/labels';
import type { ChangeType, PirDueItem } from '../types';

const CLASS_OF: Record<ChangeType, string> = {
  routine: 'RoutineChange',
  normal: 'NormalChange',
  emergency: 'EmergencyChange',
};

const columns: Column<PirDueItem>[] = [
  {
    id: 'ref',
    header: 'Change',
    accessorKey: 'ref',
    size: 300,
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <Link
          className="truncate font-medium text-brand-ink hover:underline"
          to={`/records/${CLASS_OF[row.original.type]}/${row.original.id}`}
        >
          {row.original.ref}
        </Link>
        <span className="truncate text-ink-muted">{row.original.title}</span>
      </span>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    accessorKey: 'type',
    size: 110,
    cell: ({ row }) => (
      <Badge size="sm" tone={TYPE_TONE[row.original.type]}>
        {TYPE_LABEL[row.original.type]}
      </Badge>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    size: 120,
    cell: ({ row }) => STATUS_LABEL[row.original.status],
  },
  { id: 'organization', header: 'Organization', accessorKey: 'organization', size: 150 },
  { id: 'team', header: 'Team', accessorKey: 'team', size: 150 },
  {
    id: 'end',
    header: 'Planned end',
    accessorKey: 'endDate',
    size: 170,
    cell: ({ row }) =>
      row.original.endDate ? dateTimeText(row.original.endDate) : <span className="text-ink-muted">Not set</span>,
  },
];

/**
 * Changes that are in (implemented, monitored, or recently closed) and have
 * no post-implementation review yet, the longest-waiting first. The review is
 * written on the change's CAB & plans tab.
 */
export function PirQueuePage() {
  const { data, isLoading, isError, error } = usePirQueue();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'PIR due' }]}
        title="Post-implementation reviews due"
        description="Changes that went in and still need a review of how it went."
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the changes. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Changes"
          subtitle={
            data
              ? `${data.items.length} waiting · closed changes count for ${data.lookbackDays} days`
              : undefined
          }
        />
        <CardBody>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            density="compact"
            emptyTitle="Every change is reviewed"
            emptyDescription="Implemented changes show here until their review is written."
          />
        </CardBody>
      </Card>
    </>
  );
}
