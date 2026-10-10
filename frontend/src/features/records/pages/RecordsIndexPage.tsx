import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Database, Search, Ticket, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, Input, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useClasses } from '../api/useRecords';
import type { ClassSummary } from '../types';

/** Buckets a class by what it is, so 140 names arrive as a few groups. */
function groupOf(c: ClassSummary): 'tickets' | 'ci' | 'contacts' | 'other' {
  if (c.hasLifecycle || c.inherits.includes('Ticket')) return 'tickets';
  if (c.isCi) return 'ci';
  if (['Person', 'Team', 'Organization', 'Contact'].includes(c.name)) return 'contacts';
  return 'other';
}

const GROUPS = [
  { key: 'tickets', label: 'Tickets & workflow', icon: Ticket },
  { key: 'ci', label: 'Configuration items', icon: Boxes },
  { key: 'contacts', label: 'People & organisations', icon: Users },
  { key: 'other', label: 'Everything else', icon: Database },
] as const;

/**
 * Every class iTop has, as a browsable index.
 *
 * This is the whole datamodel reachable from our own UI, through the BFF —
 * no bespoke screen per class, and nothing to add when iTop gains one.
 */
export function RecordsIndexPage() {
  const { data, isLoading, isError, error } = useClasses();
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase();
    // Abstract classes cannot hold rows, so listing them would offer a page
    // that is always empty.
    const concrete = (data?.classes ?? []).filter(
      (c) => !c.abstract && (!term || c.name.toLowerCase().includes(term)),
    );
    return GROUPS.map((g) => ({
      ...g,
      items: concrete.filter((c) => groupOf(c) === g.key).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length > 0);
  }, [data, query]);

  const total = grouped.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Records' }]}
        title="Records"
        description="Every class in the iTop datamodel, browsable and editable through the BFF."
      />

      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the schema. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <div className="mb-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter classes…"
          aria-label="Filter classes"
          leadingIcon={<Search className="size-4" />}
          className="w-full sm:w-80"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : total === 0 ? (
        <Card>
          <EmptyState title="No class matches that filter" description="Try a shorter term." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {grouped.map((group) => {
            const Icon = group.icon;
            return (
              <Card key={group.key}>
                <CardBody>
                  <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <Icon className="size-4 text-brand" aria-hidden />
                    {group.label}
                    <span className="ml-auto text-[12px] font-normal text-ink-muted tabular-nums">
                      {group.items.length}
                    </span>
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {group.items.map((c) => (
                      <li key={c.name}>
                        <Link
                          to={`/records/${c.name}`}
                          className="inline-block rounded-control border border-line bg-surface-sunken px-2.5 py-1 text-[12.5px] text-ink-secondary transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-ink"
                        >
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
