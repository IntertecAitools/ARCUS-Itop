import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Database, Plus, Search, SlidersHorizontal, Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, Input, Skeleton } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useNavigation } from '@/features/navigation';
import { useBulk, useClassInfo, useExport, useRecords } from '../api/useRecords';
import { BulkDeleteDialog, BulkEditDialog, BulkResultBanner } from '../components/BulkDialogs';
import { TransitionDialog } from '../components/TransitionDialog';
import { AdvancedSearch } from '../components/AdvancedSearch';
import { ExportMenu } from '../components/ExportMenu';
import { recordColumns } from '../components/RecordColumns';
import { defaultColumns, listFields } from '../lib/list-cells';
import { requiredForTransition, transitionPrompts } from '../lib/transitions';
import type { BulkRequest, BulkResult, Criterion, RecordDto } from '../types';

type BulkDialog = { kind: 'edit' } | { kind: 'delete' } | { kind: 'action'; action: string };

export function RecordListPage() {
  const { className = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';
  // A navigation view id. The filter it stands for lives in the BFF; all this
  // screen knows is that the list is narrowed and what the menu calls it.
  const view = params.get('view') ?? undefined;
  // Advanced-search conditions, kept in the URL so a search can be bookmarked
  // or shared. A malformed value is ignored rather than breaking the screen.
  const criteriaParam = params.get('criteria') ?? '';
  const criteria = useMemo<Criterion[]>(() => {
    if (!criteriaParam) return [];
    try {
      const parsed: unknown = JSON.parse(criteriaParam);
      return Array.isArray(parsed) ? (parsed as Criterion[]) : [];
    } catch {
      return [];
    }
  }, [criteriaParam]);
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: info, isLoading: schemaLoading, isError: schemaError, error } = useClassInfo(className);
  // "User Request", not "UserRequest": the class's own label once known.
  const classLabel = info?.labels?.class ?? className;

  // The menu label for the active view, so the heading reads like iTop's own
  // ("Open", "Under escalation") instead of showing a raw menu id.
  const { data: navigation } = useNavigation();
  const viewLabel = useMemo(() => {
    if (!view || !navigation) return undefined;
    for (const group of navigation.groups) {
      const entry = group.entries.find((e) => e.id === view);
      if (entry) return entry.label;
    }
    return undefined;
  }, [view, navigation]);

  /** Which columns to show: the class's own list columns (see defaultColumns). */
  const columns = useMemo(() => (info ? defaultColumns(info) : []), [info]);

  // The lifecycle state is fetched even when it is not a column: bulk actions
  // are offered per state.
  const lifecycleAttribute = info?.lifecycle?.attribute;
  const fields =
    info && columns.length
      ? [
          ...new Set([
            'id',
            ...listFields(info, columns),
            ...(lifecycleAttribute ? [lifecycleAttribute] : []),
          ]),
        ].join(',')
      : undefined;
  const { data, isLoading, isError: listError } = useRecords(
    className,
    { page, q: q || undefined, view, ...(criteria.length ? { criteria } : {}) },
    fields,
  );

  /**
   * Selected records, kept across pages so a selection can span several, as
   * in iTop's lists. The rows themselves are kept, not just ids: which bulk
   * actions apply depends on each record's current state.
   */
  const [selected, setSelected] = useState<Map<number, RecordDto>>(new Map());
  const [dialog, setDialog] = useState<BulkDialog | null>(null);
  const [outcome, setOutcome] = useState<{ verb: string; result: BulkResult } | null>(null);
  const bulk = useBulk(className);
  const exporter = useExport(className);

  // A different class or view is a different list; its selection is not this one's.
  useEffect(() => {
    setSelected(new Map());
    setOutcome(null);
  }, [className, view, criteriaParam]);

  const pageRows = useMemo(() => data?.items ?? [], [data]);
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  /** Actions every selected record can take in its current state. */
  const commonActions = useMemo(() => {
    if (!info?.lifecycle || selected.size === 0) return [];
    let common: string[] | null = null;
    for (const row of selected.values()) {
      const state = String(row.fields[info.lifecycle.attribute] ?? '');
      const userActions = new Set(info.lifecycle.userActions ?? info.lifecycle.stimuli);
      const available = (info.lifecycle.states[state] ?? []).filter((a) => userActions.has(a));
      common = common === null ? available : common.filter((a) => available.includes(a));
    }
    return common ?? [];
  }, [info, selected]);

  /** What the action needs across the whole selection, as one form. */
  const actionForm = (action: string) => {
    const prompts = new Set<string>();
    const required = new Set<string>();
    if (info) {
      for (const row of selected.values()) {
        for (const a of transitionPrompts(info, row, action)) prompts.add(a);
        for (const a of requiredForTransition(info, row, action)) required.add(a);
      }
    }
    return { prompts: [...prompts], required };
  };

  const ids = [...selected.keys()];
  const run = (verb: string, request: BulkRequest) =>
    bulk.mutate(request, {
      onSuccess: (result) => {
        setOutcome({ verb, result });
        setDialog(null);
        // Keep only what failed selected, so it can be retried or inspected.
        const failed = new Set(result.results.filter((r) => !r.ok).map((r) => r.id));
        setSelected((current) => new Map([...current].filter(([id]) => failed.has(id))));
      },
    });
  const runAction = (action: string) => {
    if (actionForm(action).prompts.length > 0) {
      bulk.reset();
      setDialog({ kind: 'action', action });
    } else {
      run('updated', { action: 'stimulus', ids, stimulus: action });
    }
  };
  const openDialog = (next: BulkDialog) => {
    bulk.reset();
    setDialog(next);
  };

  const selectColumn = useMemo<Column<RecordDto>>(
    () => ({
      id: 'select',
      size: 36,
      enableSorting: false,
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all on this page"
          checked={allOnPage}
          onChange={() =>
            setSelected((current) => {
              const next = new Map(current);
              for (const row of pageRows) {
                if (allOnPage) next.delete(row.id);
                else next.set(row.id, row);
              }
              return next;
            })
          }
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select #${row.original.id}`}
          checked={selected.has(row.original.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() =>
            setSelected((current) => {
              const next = new Map(current);
              if (next.has(row.original.id)) next.delete(row.original.id);
              else next.set(row.original.id, row.original);
              return next;
            })
          }
        />
      ),
    }),
    [allOnPage, pageRows, selected],
  );

  // `info` carries the labels the headers and cells read, so it belongs in
  // the dependencies — without it the first render's wording would stick.
  const tableColumns = useMemo<Column<RecordDto>[]>(
    () => [selectColumn, ...recordColumns(className, info, columns)],
    [columns, className, info, selectColumn],
  );

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  if (schemaError) {
    return (
      <>
        <PageHeader
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Records', to: '/records' }, { label: className }]}
          title="Unknown class"
        />
        <Card>
          <EmptyState
            icon={<Database className="size-5" />}
            title={`No record type called "${className}"`}
            description={error instanceof Error ? error.message : undefined}
            action={
              <Link to="/records" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Back to records
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Records', to: '/records' }, { label: classLabel }]}
        title={classLabel}
        description={
          data
            ? [
                `${data.total} ${data.total === 1 ? 'record' : 'records'}`,
                // Say that a filter is applied and whose it is. Without this a
                // narrowed list is indistinguishable from an empty class.
                viewLabel ? `filtered: ${viewLabel}` : null,
                data.sortedInBff ? 'sorted by the BFF' : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : info?.isCi
              ? 'A configuration item.'
              : 'A record type.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view ? (
              <Link
                to={`/records/${className}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                Clear filter
              </Link>
            ) : null}
            {info ? (
              <ExportMenu
                info={info}
                listColumns={columns}
                pending={exporter.isPending}
                error={exporter.isError ? (exporter.error instanceof Error ? exporter.error.message : 'The export failed.') : undefined}
                onExport={(format, exportedFields) =>
                  exporter.mutate({
                    format,
                    q: q || undefined,
                    view,
                    fields: exportedFields,
                    ...(criteria.length ? { criteria } : {}),
                  })
                }
              />
            ) : null}
            {info && !info.abstract ? (
              <Link
                to={`/records/${className}/import`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                <Upload className="me-1.5 size-4" />
                Import
              </Link>
            ) : null}
            {info && !info.abstract ? (
              <Link
                to={`/records/${className}/new`}
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                <Plus className="me-1.5 size-4" />
                New
              </Link>
            ) : null}
            <Link to="/records" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
              All classes
            </Link>
          </div>
        }
      />

      {listError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load {classLabel} records.
        </div>
      ) : null}

      {outcome ? (
        <BulkResultBanner verb={outcome.verb} result={outcome.result} onDismiss={() => setOutcome(null)} />
      ) : null}

      {selected.size > 0 && info ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface-raised px-3 py-2">
          <span className="me-2 text-[13px] font-medium text-ink">{selected.size} selected</span>
          {commonActions.map((action) => (
            <Button
              key={action}
              variant="secondary"
              size="sm"
              loading={bulk.isPending && dialog === null && bulk.variables?.action === 'stimulus' && bulk.variables.stimulus === action}
              onClick={() => runAction(action)}
            >
              {info.labels.stimuli?.[action] ?? action}
            </Button>
          ))}
          <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'edit' })}>
            Modify…
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'delete' })}>
            Delete…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {info && dialog?.kind === 'edit' ? (
        <BulkEditDialog
          info={info}
          count={selected.size}
          pending={bulk.isPending}
          error={bulk.error instanceof Error ? bulk.error.message : undefined}
          onApply={(fields) => run('updated', { action: 'update', ids, fields })}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {info && dialog?.kind === 'delete' ? (
        <BulkDeleteDialog
          info={info}
          ids={ids}
          pending={bulk.isPending}
          error={bulk.error instanceof Error ? bulk.error.message : undefined}
          onConfirm={() => run('deleted', { action: 'delete', ids })}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {info && dialog?.kind === 'action' ? (
        <TransitionDialog
          info={info}
          // One form for the whole selection, so it starts empty.
          record={{ class: info.name, id: 0, label: `${selected.size} records`, fields: {} }}
          action={dialog.action}
          {...actionForm(dialog.action)}
          pending={bulk.isPending}
          error={bulk.error instanceof Error ? bulk.error.message : undefined}
          onApply={(fields) =>
            run('updated', { action: 'stimulus', ids, stimulus: dialog.action, fields })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          defaultValue={q}
          onChange={(e) => update({ q: e.target.value || undefined })}
          placeholder={`Search ${classLabel}…`}
          aria-label={`Search ${classLabel}`}
          leadingIcon={<Search className="size-4" />}
          className="w-full sm:w-80"
        />
        {info?.criteria && Object.keys(info.criteria).length > 0 ? (
          <Button
            variant={criteria.length ? 'primary' : 'secondary'}
            size="sm"
            leadingIcon={<SlidersHorizontal className="size-4" />}
            onClick={() => setSearchOpen((o) => !o)}
            aria-expanded={searchOpen}
          >
            Advanced search{criteria.length ? ` (${criteria.length})` : ''}
          </Button>
        ) : null}
      </div>

      {searchOpen && info ? (
        <AdvancedSearch
          // Re-mount on an applied change, so the panel shows what is in effect.
          key={criteriaParam}
          info={info}
          value={criteria}
          onClose={() => setSearchOpen(false)}
          onApply={(next) => {
            update({ criteria: next.length ? JSON.stringify(next) : undefined });
            if (next.length === 0) setSearchOpen(false);
          }}
        />
      ) : null}

      <Card>
        {schemaLoading ? (
          <Skeleton className="m-4 h-64" />
        ) : !isLoading && data?.items.length === 0 ? (
          <EmptyState
            icon={<Database className="size-5" />}
            title={q ? 'No records match that search' : `No ${classLabel} records yet`}
            description={q ? 'Try a shorter term.' : 'Records you create appear here.'}
          />
        ) : (
          <>
            <DataTable
              data={data?.items ?? []}
              columns={tableColumns}
              isLoading={isLoading}
              loadingRows={8}
              onRowClick={(record) => navigate(`/records/${className}/${record.id}`)}
            />
            {data && data.pages > 1 ? (
              <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
                <p className="text-[13px] text-ink-muted tabular-nums">
                  Page {data.page} of {data.pages} · {data.total} total
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) })}
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= data.pages}
                    onClick={() => update({ page: String(page + 1) })}
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
