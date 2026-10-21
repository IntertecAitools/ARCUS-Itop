import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Input, Select, Skeleton } from '@/components/ui';
import { useSession } from '@/features/auth';
import {
  ConditionRows,
  exportableColumns,
  humaniseAttcode,
  useClassInfo,
  type Criterion,
} from '@/features/records';
import { useDeleteQuery, useQueryOptions, useRunDraft, useSaveQuery, useSavedQuery } from '../api/queries.api';
import { ResultsTable } from '../components/ResultsTable';
import { draftOf, draftProblem, resultColumns, resultFields, toInput, type Draft } from '../lib/queries';
import type { SavedQuery } from '../types';

const LABEL = 'mb-1.5 block text-[13px] font-medium text-ink';
const HINT = 'mt-1 text-[12px] text-ink-muted';
const TEXTAREA =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none ' +
  'placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader title={title} {...(subtitle ? { subtitle } : {})} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
      {message}
    </div>
  );
}

/** `/queries/new` writes a query; `/queries/:id` edits one (or shows it, to those who may not). */
export function QueryEditorPage() {
  const { id = '' } = useParams();
  const { data: query, isLoading, isError, error } = useSavedQuery(id);
  if (id !== 'new' && isLoading) return <Skeleton className="h-96 w-full" />;
  if (id !== 'new' && (isError || !query)) {
    return <ErrorNote message={error instanceof Error ? error.message : 'This query could not be loaded.'} />;
  }
  return <QueryEditor id={id} query={query} key={query?.id ?? 'new'} />;
}

function QueryEditor({ id, query }: { id: string; query: SavedQuery | undefined }) {
  const navigate = useNavigate();
  const { data: user } = useSession();
  const isAdmin = Boolean(user?.isAdmin);
  const save = useSaveQuery(id);
  const remove = useDeleteQuery();
  const run = useRunDraft();
  const { data: options } = useQueryOptions();

  const [draft, setDraft] = useState<Draft>(() => draftOf(query, 'UserRequest'));
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // In OQL mode the kind of record is whatever the query selects; it is known once it has run.
  const typeShown = draft.mode === 'oql' ? (run.data?.recordType ?? query?.recordType ?? '') : draft.recordType;
  const { data: classInfo } = useClassInfo(typeShown);
  const editable = !query || query.canEdit;
  const asOql = draft.mode === 'oql';
  // Someone who may not write OQL cannot change a query that only exists as OQL.
  const locked = !editable || (asOql && !isAdmin);

  const typeLabel = options?.recordTypes.find((t) => t.name === draft.recordType)?.label ?? draft.recordType;
  const available = useMemo(() => (classInfo ? exportableColumns(classInfo).filter((c) => c !== 'id') : []), [classInfo]);
  const shown = classInfo ? resultColumns(draft.columns, classInfo) : [];

  // Conditions and columns name fields of one record type; another type starts afresh.
  const changeRecordType = (next: string) => {
    set({ recordType: next, conditions: [], columns: [] });
    run.reset();
  };
  const toggleColumn = (code: string) =>
    set({ columns: draft.columns.includes(code) ? draft.columns.filter((c) => c !== code) : [...draft.columns, code] });

  const runNow = (nextPage = 1) => {
    const problem = draftProblem(draft, false);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setPage(nextPage);
    run.mutate({
      query: toInput(draft, classInfo),
      page: nextPage,
      // The columns are known once the kind of record is; until then the BFF's defaults.
      ...(classInfo && !asOql ? { fields: resultFields(classInfo, shown) } : {}),
    });
  };

  const submit = (thenRun: boolean) => {
    const problem = draftProblem(draft, true);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    save.mutate(toInput(draft, classInfo), {
      onSuccess: (saved) => navigate(thenRun && saved.runnable ? `/queries/${saved.id}/run` : '/queries'),
    });
  };

  const error =
    formError ??
    (save.error instanceof Error
      ? save.error.message
      : remove.error instanceof Error
        ? remove.error.message
        : run.error instanceof Error
          ? run.error.message
          : null);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Queries', to: '/queries' }, { label: query ? query.name : 'New query' }]}
        title={query ? query.name : 'New query'}
        description="A saved search: the kind of record it lists, and which of them."
        actions={
          <div className="flex items-center gap-2">
            {query?.runnable ? (
              <Link to={`/queries/${query.id}/run`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                <Play className="mr-1.5 size-4" aria-hidden />
                Results
              </Link>
            ) : null}
            <Link to="/queries" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="mr-1.5 size-4" />
              Queries
            </Link>
          </div>
        }
      />

      {error ? <ErrorNote message={error} /> : null}
      {query && !editable ? (
        <p className="mb-4 text-[13px] text-ink-secondary">
          {query.mode === 'oql' || query.template
            ? 'Only an administrator can change this query.'
            : 'Only its owner or an administrator can change this query.'}{' '}
          You can still run it.
        </p>
      ) : null}
      {query && query.parameters.length ? (
        <p className="mb-4 text-[13px] text-ink-secondary">
          iTop uses this query in notifications, where it is run against the record that set it off. It needs values
          from that record ({query.parameters.join(', ')}), so it cannot be run on its own.
        </p>
      ) : null}

      <Section title="Query">
        <div>
          <label htmlFor="query-name" className={LABEL}>
            Name
          </label>
          <Input
            id="query-name"
            value={draft.name}
            disabled={locked}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Open requests of my team"
          />
        </div>
        <div>
          <label htmlFor="query-description" className={LABEL}>
            Description
          </label>
          <Input
            id="query-description"
            value={draft.description}
            disabled={locked}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>
      </Section>

      <Section title="What it lists">
        {isAdmin && !locked ? (
          <div className="flex gap-4 text-[13px] text-ink" role="radiogroup" aria-label="How the query is written">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={!asOql}
                // Back to conditions: what was written as OQL cannot be carried over.
                onChange={() => {
                  set({ mode: 'conditions', conditions: query?.mode === 'conditions' ? query.conditions : [] });
                  run.reset();
                }}
              />
              Conditions
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={asOql}
                onChange={() => {
                  set({ mode: 'oql', oql: draft.oql || query?.oql || '' });
                  run.reset();
                }}
              />
              Advanced: iTop’s query language
            </label>
          </div>
        ) : null}

        {asOql ? (
          <div>
            <label htmlFor="query-oql" className={LABEL}>
              Query
            </label>
            {isAdmin ? (
              <>
                <textarea
                  id="query-oql"
                  rows={6}
                  className={TEXTAREA}
                  value={draft.oql}
                  disabled={locked}
                  spellCheck={false}
                  onChange={(e) => set({ oql: e.target.value })}
                  placeholder="SELECT …"
                />
                <p className={HINT}>
                  iTop runs it before it is saved; if iTop cannot, its reason is shown above. Everyone who runs it sees
                  only the records their own rights allow.
                </p>
              </>
            ) : (
              <p className="text-[13px] text-ink-secondary">
                Written by an administrator in iTop’s query language{query?.recordTypeLabel ? `; it lists ${query.recordTypeLabel}` : ''}.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="sm:w-1/2">
              <label htmlFor="record-type" className={LABEL}>
                Kind of record
              </label>
              <Select
                id="record-type"
                value={draft.recordType}
                disabled={locked}
                onChange={(e) => changeRecordType(e.target.value)}
                options={(options?.recordTypes ?? [{ name: draft.recordType, label: typeLabel }]).map((t) => ({
                  value: t.name,
                  label: t.label,
                }))}
              />
            </div>
            <div>
              <span className={LABEL}>Only those where…</span>
              {classInfo ? (
                <ConditionRows
                  info={classInfo}
                  value={draft.conditions}
                  onChange={(conditions: Criterion[]) => set({ conditions })}
                  // Fixed dates cannot be read back from the stored query.
                  exclude={(_, kind) => kind === 'date'}
                  valueLabels={query?.valueLabels ?? {}}
                  emptyText={`No conditions: every ${typeLabel} you may see.`}
                />
              ) : (
                <Skeleton className="h-9 w-full" />
              )}
            </div>
          </>
        )}
      </Section>

      {classInfo && !locked ? (
        <Section title="Columns" subtitle="Shown in the results and offered first when exporting. None chosen: the usual list columns.">
          <div className="grid max-h-64 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-3">
            {available.map((code) => (
              <label key={code} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={draft.columns.includes(code)} onChange={() => toggleColumn(code)} />
                <span className="truncate" title={code}>
                  {classInfo.labels?.fields?.[code] ?? humaniseAttcode(code)}
                </span>
              </label>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {query && editable && (isAdmin || query.mode === 'conditions') ? (
          <Button
            variant="ghost"
            leadingIcon={<Trash2 className="size-4" />}
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the query “${query.name}”? This cannot be undone.`)) {
                remove.mutate(query.id, { onSuccess: () => navigate('/queries', { replace: true }) });
              }
            }}
          >
            Delete query
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {!locked ? (
            <Button variant="secondary" leadingIcon={<Play className="size-4" aria-hidden />} loading={run.isPending} onClick={() => runNow(1)}>
              Run
            </Button>
          ) : null}
          {!locked ? (
            <Button onClick={() => submit(true)} loading={save.isPending}>
              {query ? 'Save and show results' : 'Save query'}
            </Button>
          ) : null}
        </div>
      </div>

      {run.data && classInfo && classInfo.name === run.data.recordType ? (
        <Card>
          <CardHeader
            title="Results"
            subtitle={`${run.data.total} ${run.data.total === 1 ? 'record' : 'records'} you can see · not saved yet`}
          />
          <ResultsTable
            info={classInfo}
            columns={resultColumns(run.data.columns, classInfo)}
            result={run.data}
            isLoading={run.isPending}
            page={page}
            onPage={(next) => runNow(next)}
          />
        </Card>
      ) : null}
    </>
  );
}
