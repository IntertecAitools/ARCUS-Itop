import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Plus, Search } from 'lucide-react';

import { PageHeader } from '@/components/layout';
import { Card, CardBody, Input, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { entryPath, useNavigation } from '../api/useNavigation';
import type { NavDiagnostic } from '../types';

/**
 * Every module iTop has, and what we do with it.
 *
 * Two jobs. It is the index the sidebar folds into when collapsed, and it is
 * the honest accounting of the replication: the groups we render, and
 * underneath, the menu nodes iTop has that we do not — each with a reason.
 * "We replicated iTop" is a claim, and this page is where it can be checked.
 */

/** Groups the reasons the BFF reports into something a person can act on. */
const REASON_GROUPS: { match: string; label: string; detail: string }[] = [
  {
    match: 'itop-dashboard',
    label: 'iTop dashboards',
    detail:
      'Panels composed in iTop’s XML. The underlying data is reachable through the lists above; the composed dashboard is not replicated.',
  },
  {
    match: 'itop-admin-page',
    label: 'iTop’s own admin tools',
    detail:
      'CSV import, the config editor, DB tools, backup and update. These administer iTop itself rather than showing data, so they stay in iTop.',
  },
  {
    match: 'needs-auth',
    label: 'Waiting on sign-in',
    detail:
      '“My incidents”-style views filter on the logged-in contact. There is no authenticated user yet, so these are withheld rather than shipped broken.',
  },
  {
    match: 'absent-from-schema',
    label: 'iTop internals',
    detail:
      'Classes iTop uses for its own bookkeeping, deliberately left out of the published schema.',
  },
  {
    match: 'empty',
    label: 'Nothing to show',
    detail: 'Groups whose every entry fell into one of the categories above.',
  },
];

function bucketOf(diagnostic: NavDiagnostic) {
  return REASON_GROUPS.find((group) => diagnostic.reason.startsWith(group.match))?.label ?? 'Other';
}

export function ModulesIndexPage() {
  const { data, isLoading, isError, error } = useNavigation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLowerCase();
    if (!term) return data.groups;
    return data.groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter(
          (entry) =>
            entry.label.toLowerCase().includes(term) ||
            entry.class.toLowerCase().includes(term),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [data, query]);

  const buckets = useMemo(() => {
    if (!data) return [];
    const byLabel = new Map<string, NavDiagnostic[]>();
    for (const diagnostic of data.excluded) {
      const label = bucketOf(diagnostic);
      byLabel.set(label, [...(byLabel.get(label) ?? []), diagnostic]);
    }
    return REASON_GROUPS.map((group) => ({
      ...group,
      items: byLabel.get(group.label) ?? [],
    })).filter((group) => group.items.length > 0);
  }, [data]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Modules' }]}
        title="Modules"
        description={
          data
            ? `${data.counts.entries} screens across ${data.counts.groups} of iTop’s menu groups, published by the BFF.`
            : 'iTop’s modules, published by the BFF.'
        }
      />

      {isError ? (
        <div
          role="alert"
          className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          Couldn’t load the module list. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <div className="mb-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter modules…"
          aria-label="Filter modules"
          leadingIcon={<Search className="size-4" />}
          className="w-full sm:w-80"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState title="No module matches that filter" description="Try a shorter term." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardBody>
                <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
                  {/* Its own element so the label is addressable on its own,
                      rather than only as "<label> <count>". */}
                  <span>{group.label}</span>
                  {group.isAdmin ? (
                    <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide text-ink-muted uppercase">
                      admin
                    </span>
                  ) : null}
                  <span className="ml-auto text-[12px] font-normal text-ink-muted tabular-nums">
                    {group.entries.length}
                  </span>
                </p>

                <ul className="space-y-1">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        to={entryPath(entry)}
                        className={cn(
                          'flex items-center gap-2 rounded-control border border-transparent px-2.5 py-1.5',
                          'text-[13px] text-ink-secondary transition-colors',
                          'hover:border-brand/40 hover:bg-brand-soft hover:text-brand-ink',
                        )}
                      >
                        {entry.kind === 'create' ? (
                          <Plus className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                        ) : entry.kind === 'search' ? (
                          <Search className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                        ) : (
                          <span className="size-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="flex-1 truncate">{entry.label}</span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                          {entry.class}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {buckets.length > 0 ? (
        <Card className="mt-4">
          <CardBody>
            <p className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Info className="size-4 text-ink-muted" aria-hidden />
              What iTop has that this does not
            </p>
            <p className="mb-3 text-[12.5px] text-ink-secondary">
              {data?.counts.excluded} of iTop’s menu entries are not rendered here. Each is listed
              with its reason rather than quietly omitted.
            </p>

            <dl className="space-y-3">
              {buckets.map((bucket) => (
                <div key={bucket.label}>
                  <dt className="flex items-baseline gap-2 text-[12.5px] font-medium text-ink">
                    {bucket.label}
                    <span className="text-[11.5px] font-normal text-ink-muted tabular-nums">
                      {bucket.items.length}
                    </span>
                  </dt>
                  <dd className="text-[12.5px] text-ink-secondary">
                    {bucket.detail}
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                      {bucket.items.map((item) => item.id).join(', ')}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
