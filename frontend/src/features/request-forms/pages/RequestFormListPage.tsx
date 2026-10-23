import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { useFormCatalogue } from '../api/request-forms.api';
import type { FormCatalogueService } from '../types';

const count = (n: number) => (n === 0 ? 'No questions' : n === 1 ? '1 question' : `${n} questions`);

/**
 * The service catalogue, each item with the extra questions it asks when a
 * request is raised. A service's questions are asked for all of it; a
 * subcategory's are added after them.
 */
export function RequestFormListPage() {
  const { data: services, isLoading, isError, error } = useFormCatalogue();

  const families = useMemo(() => {
    const groups = new Map<string, FormCatalogueService[]>();
    for (const s of services ?? []) {
      const key = s.family || 'Other services';
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()];
  }, [services]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Request forms' }]}
        title="Request forms"
        description="The extra questions each service asks when someone raises a request, on the portal and in New request. Answers are written into the request."
      />
      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'The catalogue could not be loaded.'}
        </div>
      ) : null}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : families.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="No services yet"
            description="Request forms belong to services in the catalogue. Add a service first."
          />
        </Card>
      ) : (
        families.map(([family, items]) => (
          <Card key={family} className="mb-4">
            <CardHeader title={family} />
            <CardBody className="p-0">
              <ul className="divide-y divide-line">
                {items.map((s) => (
                  <li key={s.id}>
                    <Row to={`/request-forms/service/${s.id}`} name={s.name} fieldCount={s.fieldCount} />
                    {s.subcategories.map((sc) => (
                      <Row
                        key={sc.id}
                        to={`/request-forms/subcategory/${sc.id}`}
                        name={sc.name}
                        fieldCount={sc.fieldCount}
                        nested
                      />
                    ))}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))
      )}
    </>
  );
}

function Row({ to, name, fieldCount, nested }: { to: string; name: string; fieldCount: number; nested?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-2.5 text-[13px] transition-colors hover:bg-surface-hover',
        nested ? 'ps-10 text-ink-secondary' : 'font-medium text-ink',
      )}
    >
      <span className="truncate">{name}</span>
      <span className={cn('shrink-0 text-[12.5px]', fieldCount ? 'text-brand-ink' : 'text-ink-muted')}>{count(fieldCount)}</span>
    </Link>
  );
}
