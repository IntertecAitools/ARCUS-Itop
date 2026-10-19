import { useParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout';
import { Skeleton } from '@/components/ui';
import { Card, CardBody } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { useDashboard } from '../api/useDashboard';
import { Dashlet } from '../components/Dashlet';

/**
 * One of iTop's Overview dashboards, rendered natively.
 *
 * The layout and panels come from iTop's own definition (via the BFF); each
 * panel's numbers are computed by the BFF from the dashlet's OQL. Nothing here
 * is hardcoded per dashboard — a new Overview in iTop appears on its own.
 */
export function DashboardViewPage() {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error } = useDashboard(id);

  const crumbs = [{ label: 'Home', to: '/' }, { label: 'Dashboards' }, { label: data?.title ?? id }];

  if (isError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Dashboard not found" />
        <Card>
          <CardBody>
            <EmptyState
              title={`No dashboard called "${id}"`}
              description={error instanceof Error ? error.message : undefined}
            />
          </CardBody>
        </Card>
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Loading…" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </>
    );
  }

  // iTop lays dashboards out in 1, 2 or 3 columns. At our widths 3 is cramped,
  // so 3-col dashboards fall back to 2.
  const cols = Math.min(data.columns, 2);

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title={data.title} />
      <div
        className={cn(
          'grid grid-cols-1 gap-4',
          cols >= 2 && 'md:grid-cols-2',
        )}
      >
        {data.dashlets.map((dashlet) => (
          <Dashlet key={dashlet.id} dashboardId={data.id} dashlet={dashlet} />
        ))}
      </div>
    </>
  );
}
