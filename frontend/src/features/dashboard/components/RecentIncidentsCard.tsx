import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const columns = useMemo(() => ticketColumns(t), [t]);

  return (
    <Card className="h-full">
      <CardHeader title={t('dashboard.recent.title')} action={<ViewAllLink to="/incidents" />} />
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
          emptyTitle={t('dashboard.recent.emptyTitle')}
          emptyDescription={t('dashboard.recent.emptyLead')}
        />
      </CardBody>
    </Card>
  );
}
