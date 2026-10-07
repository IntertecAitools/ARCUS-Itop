import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader, Tabs } from '@/components/ui';
import { DataTable } from '@/components/data-display';
import { isModuleRegistered } from '@/config/modules';
import type { DashboardOverview } from '../types';
import { ticketColumns } from './ticketColumns';
import { ViewAllLink } from './ViewAllLink';

type TabId = 'incidents' | 'approvals' | 'requests';

/** The current user's own queue, split by work type. */
export function MyAssignmentsCard({
  data,
  isLoading,
}: {
  data?: DashboardOverview['myAssignments'];
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('incidents');

  // No assignee column — every row here is already assigned to the viewer.
  const columns = useMemo(() => ticketColumns({ withAssignee: false, withCreated: false }), []);

  const rows = data?.[tab] ?? [];

  return (
    <Card className="h-full">
      <CardHeader title="My Assignments" action={<ViewAllLink to="/incidents?assignee=me" />} />
      <CardBody className="px-2 pb-2">
        <Tabs
          className="mb-1 px-3"
          value={tab}
          onChange={(id) => setTab(id as TabId)}
          items={[
            { id: 'incidents', label: 'Incidents', count: data?.incidents.length },
            { id: 'approvals', label: 'Approvals', count: data?.approvals.length },
            { id: 'requests', label: 'Requests', count: data?.requests.length },
          ]}
        />
        <DataTable
          data={rows}
          columns={columns}
          isLoading={isLoading}
          loadingRows={4}
          onRowClick={
            isModuleRegistered('/incidents')
              ? (ticket) => navigate(`/incidents/${ticket.id}`)
              : undefined
          }
          emptyTitle="Nothing assigned to you"
          emptyDescription="You're all caught up in this queue."
        />
      </CardBody>
    </Card>
  );
}
