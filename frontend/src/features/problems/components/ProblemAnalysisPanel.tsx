import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { useProblemAnalysis, useSaveAnalysis } from '../api/useProblems';
import type { RootCauseAnalysis } from '../types';
import { CreateKnownErrorDialog } from './CreateKnownErrorDialog';

const FIELDS: Array<{ key: keyof RootCauseAnalysis; label: string; hint: string }> = [
  { key: 'rootCause', label: 'Root cause', hint: 'Why it happens: the underlying fault, not the symptom.' },
  { key: 'workaround', label: 'Workaround', hint: 'How to restore service until it is fixed.' },
  { key: 'resolution', label: 'Resolution', hint: 'The permanent fix, once known.' },
];

const EMPTY: RootCauseAnalysis = { rootCause: '', workaround: '', resolution: '' };

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

const pick = (a: RootCauseAnalysis): RootCauseAnalysis => ({
  rootCause: a.rootCause,
  workaround: a.workaround,
  resolution: a.resolution,
});

const sameAs = (a: RootCauseAnalysis, b: RootCauseAnalysis) =>
  FIELDS.every(({ key }) => a[key].trim() === b[key].trim());

/**
 * The problem's root-cause analysis, and the known errors raised from it.
 *
 * The analysis is three fields on the problem itself (added to iTop by the
 * arcus-problem-rca extension), so each change shows in its History tab.
 */
export function ProblemAnalysisPanel({ id }: { id: string }) {
  const analysis = useProblemAnalysis(id);
  const save = useSaveAnalysis(id);
  const [draft, setDraft] = useState<RootCauseAnalysis>(EMPTY);
  const [raising, setRaising] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  // Load the saved version into the form, and again after every save.
  useEffect(() => {
    if (analysis.data) setDraft(pick(analysis.data));
  }, [analysis.data]);

  if (analysis.isLoading) return <Skeleton className="h-80 w-full" />;
  if (analysis.isError || !analysis.data) {
    return (
      <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
        {analysis.error instanceof Error ? analysis.error.message : 'The analysis could not be loaded.'}
      </div>
    );
  }

  const data = analysis.data;
  const saved = pick(data);
  const dirty = !sameAs(draft, saved);
  const canRaise = data.available && Boolean(saved.rootCause || saved.workaround) && !dirty;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title="Root cause analysis"
          subtitle={
            !data.available
              ? 'Not available on this iTop'
              : saved.rootCause || saved.workaround || saved.resolution
                ? 'Changes are recorded in the History tab.'
                : 'Not analysed yet'
          }
        />
        <CardBody>
          {!data.available ? (
            <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink">
              This iTop has no root-cause fields on problems yet. An administrator installs the
              arcus-problem-rca extension to turn them on.
            </div>
          ) : null}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            {FIELDS.map(({ key, label, hint }) => (
              <div key={key} className="space-y-1.5">
                <label htmlFor={`rca-${key}`} className="block text-[13px] font-medium text-ink">
                  {label}
                </label>
                <textarea
                  id={`rca-${key}`}
                  rows={key === 'rootCause' ? 5 : 3}
                  className={CONTROL}
                  placeholder={hint}
                  value={draft[key]}
                  disabled={!data.available}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              </div>
            ))}

            {save.isError ? (
              <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
                {save.error instanceof Error ? save.error.message : 'The analysis could not be saved.'}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              {dirty ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(saved)}>
                  Discard changes
                </Button>
              ) : null}
              <Button type="submit" size="sm" disabled={!dirty || !data.available} loading={save.isPending}>
                Save analysis
              </Button>
            </div>
          </form>

        </CardBody>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Known errors" subtitle="Reusable diagnosis for agents handling new incidents." />
        <CardBody className="space-y-3">
          {created ? (
            <div role="status" className="rounded-card border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good-ink">
              Known error{' '}
              <Link className="font-medium underline" to={`/records/KnownError/${created.id}`}>
                {created.name}
              </Link>{' '}
              created.
            </div>
          ) : null}

          {data.knownErrors.length ? (
            <ul className="space-y-1.5 text-[13px]">
              {data.knownErrors.map((ke) => (
                <li key={ke.id} className="flex items-center gap-2">
                  <BookMarked className="size-4 shrink-0 text-ink-muted" />
                  <Link className="truncate text-brand-ink hover:underline" to={`/records/KnownError/${ke.id}`}>
                    {ke.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-muted">None raised from this problem yet.</p>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            leadingIcon={<BookMarked className="size-4" />}
            disabled={!canRaise}
            onClick={() => setRaising(true)}
          >
            Create known error
          </Button>
          {!canRaise ? (
            <p className="text-[12px] text-ink-muted">
              {!data.available
                ? 'Needs the root-cause fields on this iTop.'
                : dirty
                  ? 'Save the analysis first, so the known error gets the current version.'
                  : 'Record a root cause or a workaround first.'}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {raising ? (
        <CreateKnownErrorDialog
          problemId={id}
          defaultName={`${data.ref}: ${data.title}`}
          analysis={saved}
          onClose={() => setRaising(false)}
          onCreated={(ke) => {
            setRaising(false);
            setCreated(ke);
          }}
        />
      ) : null}
    </div>
  );
}
