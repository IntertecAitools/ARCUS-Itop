import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader, Tabs } from '@/components/ui';
import { DataTable } from '@/components/data-display';
import { isModuleRegistered } from '@/config/modules';
import type { MyAssignments } from '../types';
import { changeColumns } from './changeColumns';
import { ticketColumns } from './ticketColumns';
import { ViewAllLink } from './ViewAllLink';

type TabId = keyof MyAssignments;

/**
 * Where each queue's rows and "View all" lead. Incidents have their own
 * module; requests, problems and changes open in the generic record screens,
 * filtered by the same "assigned to me" view the BFF used to build the queue.
 */
const TABS: Array<{
  id: Exclude<TabId, 'changes'>;
  label: string;
  viewAll: string;
  detail: (id: string) => string;
}> = [
  {
    id: 'incidents',
    label: 'Incidents',
    viewAll: isModuleRegistered('/incidents')
      ? // Open work only, like the card: resolved and closed are not a queue.
        '/incidents?assignee=me&status=new,open,pending'
      : '/records/Incident?view=Incident:MyIncidents',
    detail: (id) =>
      isModuleRegistered('/incidents') ? `/incidents/${id}` : `/records/Incident/${id}`,
  },
  {
    id: 'requests',
    label: 'Requests',
    viewAll: '/records/UserRequest?view=UserRequest:MyRequests',
    detail: (id) => `/records/UserRequest/${id}`,
  },
  {
    id: 'problems',
    label: 'Problems',
    viewAll: '/records/Problem?view=Problem:MyProblems',
    detail: (id) => `/records/Problem/${id}`,
  },
];

/** The current user's own open queue, split by work type, most urgent first. */
export function MyAssignmentsCard({
  data,
  isLoading,
}: {
  data?: MyAssignments;
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('incidents');

  // No assignee column — every row here is already assigned to the viewer.
  const columns = useMemo(() => ticketColumns({ withAssignee: false, withCreated: false }), []);
  const changeCols = useMemo(() => changeColumns(), []);

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const queue = data?.[tab];
  const shown = queue?.items.length ?? 0;
  const hidden = queue ? queue.total - shown : 0;
  const empty = { emptyTitle: 'Nothing assigned to you', emptyDescription: "You're all caught up in this queue." };

  return (
    <Card className="h-full">
      <CardHeader
        title="My Assignments"
        action={<ViewAllLink to={tab === 'changes' ? '/records/Change?view=MyChanges' : active.viewAll} />}
      />
      <CardBody className="px-2 pb-2">
        <Tabs
          className="mb-1 px-3"
          value={tab}
          onChange={(id) => setTab(id as TabId)}
          items={[
            ...TABS.map((t) => ({ id: t.id, label: t.label, count: data?.[t.id].total })),
            // Older BFFs send no changes queue: no count rather than a crash.
            { id: 'changes', label: 'Changes', count: data?.changes?.total },
          ]}
        />
        {tab === 'changes' ? (
          <DataTable
            data={data?.changes?.items ?? []}
            columns={changeCols}
            isLoading={isLoading}
            loadingRows={4}
            onRowClick={(change) => navigate(`/records/${change.class}/${change.id}`)}
            {...empty}
          />
        ) : (
          <DataTable
            data={data?.[tab].items ?? []}
            columns={columns}
            isLoading={isLoading}
            loadingRows={4}
            onRowClick={(ticket) => navigate(active.detail(ticket.id))}
            {...empty}
          />
        )}
        {hidden > 0 ? (
          <p className="px-3 pt-2 text-[12px] text-ink-muted">
            Showing {shown} of {queue?.total}. Use View all for the rest.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
