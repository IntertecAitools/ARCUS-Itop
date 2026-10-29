import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { DataTable, PriorityBadge, type Column } from '@/components/data-display';
import { dateTimeText } from '@/lib/utils';
import { useTeamQueue } from '../api/useDispatch';
import { TakeItButton } from '../components/TakeItButton';
import type { TakenTicket, TeamQueueItem, TicketType } from '../types';

/** Where a ticket's own screen is: incidents have theirs, requests the record screen. */
export function ticketPath(type: TicketType, id: string) {
  return type === 'incident' ? `/incidents/${id}` : `/records/UserRequest/${id}`;
}

function columns(onTaken: (ticket: TakenTicket) => void): Column<TeamQueueItem>[] {
  return [
    {
      id: 'ref',
      header: 'Ticket',
      accessorKey: 'ref',
      size: 300,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <Link
            className="truncate font-medium text-brand-ink hover:underline"
            to={ticketPath(row.original.type, row.original.id)}
          >
            {row.original.ref}
          </Link>
          <span className="truncate text-ink-muted">{row.original.summary}</span>
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      accessorKey: 'type',
      size: 100,
      cell: ({ row }) => (
        <Badge size="sm" tone="neutral">
          {row.original.type === 'incident' ? 'Incident' : 'Request'}
        </Badge>
      ),
    },
    {
      id: 'priority',
      header: 'Priority',
      accessorKey: 'priority',
      size: 110,
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} size="sm" />,
    },
    { id: 'team', header: 'Team', size: 150, cell: ({ row }) => row.original.team.name },
    { id: 'organization', header: 'Organization', accessorKey: 'organization', size: 150 },
    { id: 'service', header: 'Service', accessorKey: 'service', size: 150 },
    {
      id: 'waiting',
      header: 'With the team since',
      size: 180,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="text-ink">{dateTimeText(row.original.dispatchedAt || row.original.createdAt)}</span>
          {row.original.escalated ? (
            <Badge size="sm" tone="critical">
              Response overdue
            </Badge>
          ) : row.original.ttoDeadline ? (
            <span className="text-[12px] text-ink-muted">Respond by {dateTimeText(row.original.ttoDeadline)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'take',
      header: '',
      size: 200,
      cell: ({ row }) => <TakeItButton type={row.original.type} id={row.original.id} onTaken={onTaken} />,
    },
  ];
}

/**
 * Tickets dispatched to the teams the signed-in person belongs to that
 * nobody has taken yet, longest waiting first. "Take it" assigns one to
 * them and opens it.
 */
export function TeamQueuePage() {
  const { data, isLoading, isError, error } = useTeamQueue();
  const navigate = useNavigate();
  const onTaken = (ticket: TakenTicket) => navigate(ticketPath(ticket.type, ticket.id));

  const teams = data?.teams ?? [];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'My team’s queue' }]}
        title="My team’s queue"
        description={
          teams.length > 0
            ? `Tickets sent to ${teams.map((t) => t.name).join(', ')} that nobody has taken yet.`
            : 'Tickets sent to your teams that nobody has taken yet.'
        }
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the queue. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      {data && !data.available ? (
        <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          This platform cannot send tickets to a team yet: an administrator installs the arcus-ticket-dispatch extension.
        </div>
      ) : null}
      {data && data.available && teams.length === 0 ? (
        <div role="status" className="mb-4 rounded-card border border-line bg-surface-sunken px-4 py-3 text-[13px] text-ink">
          You are not in any team, so no queue is yours. An administrator adds you to a team under Teams.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Waiting to be taken"
          subtitle={data ? `${data.items.length}${data.truncated ? '+' : ''} waiting` : undefined}
        />
        <CardBody>
          <DataTable
            data={data?.items ?? []}
            columns={columns(onTaken)}
            isLoading={isLoading}
            density="compact"
            emptyTitle="Nothing waits for your team"
            emptyDescription="Tickets show here once they are dispatched to a team you are in."
          />
        </CardBody>
      </Card>
    </>
  );
}
