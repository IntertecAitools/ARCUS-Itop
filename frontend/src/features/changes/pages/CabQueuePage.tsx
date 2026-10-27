import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { dateTimeText } from '@/lib/utils';
import { useCabQueue } from '../api/useChanges';
import { DECISION_LABEL, PLAN_LABEL, TYPE_LABEL } from '../lib/labels';
import type { CabQueueItem, ChangeType } from '../types';

const CLASS_OF: Record<ChangeType, string> = {
  routine: 'RoutineChange',
  normal: 'NormalChange',
  emergency: 'EmergencyChange',
};

const columns: Column<CabQueueItem>[] = [
  {
    id: 'ref',
    header: 'Change',
    accessorKey: 'ref',
    size: 280,
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
      <Badge size="sm" tone={row.original.type === 'emergency' ? 'serious' : 'neutral'}>
        {TYPE_LABEL[row.original.type]}
      </Badge>
    ),
  },
  { id: 'organization', header: 'Organization', accessorKey: 'organization', size: 150 },
  {
    id: 'start',
    header: 'Scheduled',
    accessorKey: 'startDate',
    size: 170,
    cell: ({ row }) =>
      row.original.startDate ? (
        <span className="text-ink">{dateTimeText(row.original.startDate)}</span>
      ) : (
        <span className="text-ink-muted">Not scheduled</span>
      ),
  },
  {
    id: 'outage',
    header: 'Outage',
    accessorKey: 'outage',
    size: 90,
    cell: ({ row }) => (row.original.outage ? <Badge size="sm" tone="warning">Outage</Badge> : 'No'),
  },
  {
    id: 'last',
    header: 'Last CAB',
    size: 160,
    cell: ({ row }) => {
      const last = row.original.lastDecision;
      return last ? (
        <span className="text-ink">
          {DECISION_LABEL[last.decision]} {dateTimeText(last.meetingDate)}
        </span>
      ) : (
        <span className="text-ink-muted">Not reviewed</span>
      );
    },
  },
  {
    id: 'plans',
    header: 'Plans',
    size: 200,
    cell: ({ row }) =>
      row.original.missingPlans.length ? (
        <Badge size="sm" tone="warning">
          Missing {row.original.missingPlans.map((k) => PLAN_LABEL[k].toLowerCase()).join(', ')}
        </Badge>
      ) : (
        <Badge size="sm" tone="good">
          Complete
        </Badge>
      ),
  },
];

/**
 * Normal and emergency changes that are planned and wait for the Change
 * Advisory Board, soonest first. Each opens on its record screen, where a
 * Change Approver records the decision (the CAB & plans tab).
 */
export function CabQueuePage() {
  const { data, isLoading, isError, error } = useCabQueue();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Awaiting CAB' }]}
        title="Awaiting CAB"
        description="Planned normal and emergency changes waiting for the Change Advisory Board's decision."
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the changes. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      {data && !data.available ? (
        <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          This iTop cannot keep CAB decisions yet: an administrator installs the arcus-change-cab extension.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Changes"
          subtitle={data ? `${data.items.length} waiting` : undefined}
        />
        <CardBody>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            density="compact"
            emptyTitle="Nothing waits for the CAB"
            emptyDescription="Normal and emergency changes show here once they are planned."
          />
        </CardBody>
      </Card>
    </>
  );
}
