import { useParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout';
import { SectionTitle } from '@/components/public';
import { Card, CardBody, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDashboard, type PublicDashlet } from '../api/useDashboard';
import { Dashlet } from '../components/Dashlet';

/**
 * One of iTop's Overview dashboards, rendered natively.
 *
 * The layout and panels come from iTop's own definition (via the BFF); each
 * panel's numbers are computed by the BFF from the dashlet's OQL. Nothing here
 * is hardcoded per dashboard — a new Overview in iTop appears on its own.
 *
 * iTop stacks dashlets in columns; here they are regrouped by what they are,
 * which reads better at any width: a header dashlet starts a titled section,
 * the counts under it become a grid of compact tiles, and charts, tables and
 * lists sit two to a row. A "header with counts" (header-dynamic) is its own
 * section: its title, then one tile per value.
 */

interface Section {
  key: string;
  title?: string;
  tiles: PublicDashlet[];
  panels: PublicDashlet[];
}

export function sectionsOf(dashlets: PublicDashlet[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { key: 'start', tiles: [], panels: [] };
  const push = () => {
    if (current.title || current.tiles.length || current.panels.length) sections.push(current);
  };
  for (const d of dashlets) {
    if (d.kind === 'header' || d.kind === 'header-dynamic') {
      push();
      current = { key: d.id, title: d.title, tiles: d.kind === 'header-dynamic' ? [d] : [], panels: [] };
      if (d.kind === 'header-dynamic') {
        push();
        current = { key: `${d.id}-after`, tiles: [], panels: [] };
      }
    } else if (d.kind === 'badge') {
      current.tiles.push(d);
    } else {
      current.panels.push(d);
    }
  }
  push();
  return sections;
}

const TILE_GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4';

export function DashboardViewPage() {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error } = useDashboard(id);

  const crumbs = [{ label: 'Home', to: '/' }, { label: 'Dashboards' }, { label: data?.title ?? id }];

  if (isError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Dashboard not found" />
        <Card>
          <CardBody className="pt-5">
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
        <div className={TILE_GRID}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px]" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title={data.title} />
      <div className="space-y-12">
        {sectionsOf(data.dashlets).map((section) => (
          <section key={section.key} aria-label={section.title}>
            {section.title ? <SectionTitle>{section.title}</SectionTitle> : null}
            {section.tiles.length ? (
              section.tiles[0]!.kind === 'header-dynamic' ? (
                <Dashlet dashboardId={data.id} dashlet={section.tiles[0]!} />
              ) : (
                <div className={TILE_GRID}>
                  {section.tiles.map((dashlet) => (
                    <Dashlet key={dashlet.id} dashboardId={data.id} dashlet={dashlet} />
                  ))}
                </div>
              )
            ) : null}
            {section.panels.length ? (
              <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${section.tiles.length ? 'mt-6' : ''}`}>
                {section.panels.map((dashlet) => (
                  <Dashlet key={dashlet.id} dashboardId={data.id} dashlet={dashlet} />
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
