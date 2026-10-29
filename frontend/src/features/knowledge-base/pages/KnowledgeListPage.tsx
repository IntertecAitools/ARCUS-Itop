import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, buttonClasses, Card, CardBody, Input, Select, Tabs } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { useArticles } from '../api/useKnowledge';
import { KIND_LABEL, STATE_LABEL, STATE_TONE } from '../lib/labels';
import type { ArticleKind, ArticleListQuery, ArticleSummary } from '../types';

const TABS = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'in_review', label: 'In review' },
  { id: 'published', label: 'Published' },
  { id: 'review_due', label: 'Review due' },
  { id: 'retired', label: 'Retired' },
] as const;

const columns: Column<ArticleSummary>[] = [
  {
    id: 'title',
    header: 'Article',
    accessorKey: 'title',
    size: 360,
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <Link className="truncate font-medium text-brand-ink hover:underline" to={`/knowledge/${row.original.kind}/${row.original.id}`}>
          {row.original.title || '(untitled)'}
        </Link>
        <span className="truncate text-ink-muted">{row.original.summary}</span>
      </span>
    ),
  },
  { id: 'kind', header: 'Kind', size: 110, cell: ({ row }) => KIND_LABEL[row.original.kind] },
  { id: 'category', header: 'Category', accessorKey: 'category', size: 140 },
  {
    id: 'state',
    header: 'State',
    size: 120,
    cell: ({ row }) => (
      <Badge size="sm" dot tone={STATE_TONE[row.original.state]}>
        {STATE_LABEL[row.original.state]}
      </Badge>
    ),
  },
  {
    id: 'review',
    header: 'Next review',
    size: 120,
    cell: ({ row }) =>
      row.original.reviewDue ? (
        <span className={row.original.reviewOverdue ? 'font-medium text-critical-ink' : 'text-ink'}>{row.original.reviewDue}</span>
      ) : (
        <span className="text-ink-muted">—</span>
      ),
  },
  {
    id: 'helpful',
    header: 'Helpful',
    size: 110,
    cell: ({ row }) => {
      const h = row.original.helpfulness;
      return h.score === null ? (
        <span className="text-ink-muted">No votes</span>
      ) : (
        <span className="tabular-nums text-ink" title={`${h.yes} yes, ${h.no} no`}>
          {h.score}% <span className="text-ink-muted">({h.yes + h.no})</span>
        </span>
      );
    },
  },
  { id: 'author', header: 'Author', accessorKey: 'author', size: 130 },
];

/**
 * Knowledge articles (FAQs and known errors) with their editorial state:
 * search them, see what waits for review or is past its review date, and
 * open one to move it along or read what readers said about it.
 */
export function KnowledgeListPage() {
  const [params, setParams] = useSearchParams();
  const query: ArticleListQuery = {
    ...(params.get('q') ? { q: params.get('q')! } : {}),
    ...(params.get('state') ? { state: params.get('state') as ArticleListQuery['state'] } : {}),
    ...(params.get('kind') ? { kind: params.get('kind') as ArticleKind } : {}),
  };
  const { data, isLoading, isError, error } = useArticles(query);

  const set = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    setParams(p, { replace: true });
  };

  const counts = data?.counts;
  const total = counts ? counts.draft + counts.in_review + counts.published + counts.retired : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Knowledge' }]}
        title="Knowledge"
        description="FAQs and known errors: drafted, reviewed, published, retired. Only published FAQs reach the portal."
        actions={
          <div className="flex gap-2">
            <Link to="/records/FAQ/new" className={buttonClasses({ size: 'sm' })}>
              <Plus className="size-4" aria-hidden /> New FAQ
            </Link>
            <Link to="/records/KnownError/new" className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
              <Plus className="size-4" aria-hidden /> New known error
            </Link>
          </div>
        }
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the articles. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Search articles"
            placeholder="Search titles, summaries and keywords…"
            leadingIcon={<Search className="size-4" />}
            className="min-w-64 flex-1"
            defaultValue={query.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
          />
          <Select
            aria-label="Kind"
            className="w-44"
            value={query.kind ?? ''}
            onChange={(e) => set('kind', e.target.value)}
            options={[
              { value: '', label: 'FAQs and known errors' },
              { value: 'faq', label: 'FAQs' },
              { value: 'known_error', label: 'Known errors' },
            ]}
          />
        </CardBody>
        <CardBody className="pt-0">
          <Tabs
            items={TABS.map((t) => ({
              id: t.id,
              label: t.label,
              ...(counts ? { count: t.id === '' ? total : counts[t.id] } : {}),
            }))}
            value={query.state ?? ''}
            onChange={(v) => set('state', v)}
          />
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            density="compact"
            emptyTitle="No articles here"
            emptyDescription={query.q ? 'Nothing matches that search.' : 'Articles show here once they are written.'}
          />
        </CardBody>
      </Card>
    </>
  );
}
