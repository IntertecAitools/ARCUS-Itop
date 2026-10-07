import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { DataTable } from '@/components/data-display';
import { isModuleRegistered } from '@/config/modules';
import type { DashboardTicket } from '../types';
import { ticketColumns } from './ticketColumns';
import { ViewAllLink } from './ViewAllLink';

export function RecentIncidentsCard({
  data,
  isLoading,
}: {
  data?: DashboardTicket[];
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const columns = useMemo(() => ticketColumns(), []);

  return (
    <Card className="h-full">
      <CardHeader title="Recent Incidents" action={<ViewAllLink to="/incidents" />} />
      <CardBody className="px-2 pb-2">
        <DataTable
          data={data ?? []}
          columns={columns}
          isLoading={isLoading}
          // No row affordance while there is nowhere for a row to lead.
          onRowClick={
            isModuleRegistered('/incidents')
              ? (ticket) => navigate(`/incidents/${ticket.id}`)
              : undefined
          }
          emptyTitle="No incidents in this window"
          emptyDescription="Nothing has been raised in the selected period."
        />
      </CardBody>
    </Card>
  );
}
