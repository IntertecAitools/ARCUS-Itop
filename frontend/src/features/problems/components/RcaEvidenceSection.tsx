import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Select, Skeleton, type BadgeTone } from '@/components/ui';
import { isModuleRegistered } from '@/config/modules';
import { useRcaEvidence } from '../api/useProblems';
import type { CandidateCause, RcaEvidence, RecordRef } from '../types';

/** Where a record opens: incidents in their own screen, the rest in the record screen. */
export function recordHref(ref: Pick<RecordRef, 'class' | 'id'>) {
  if (ref.class === 'Incident' && isModuleRegistered('/incidents')) return `/incidents/${ref.id}`;
  return `/records/${ref.class}/${ref.id}`;
}

export function RecordLink({ record, children }: { record: Pick<RecordRef, 'class' | 'id'>; children: ReactNode }) {
  return (
    <Link className="text-brand-ink hover:underline" to={recordHref(record)}>
      {children}
    </Link>
  );
}

const CONFIDENCE_TONE: Record<CandidateCause['confidence'], BadgeTone> = {
  high: 'critical',
  medium: 'warning',
  low: 'neutral',
};

const KIND_LABEL: Record<CandidateCause['kind'], string> = {
  change: 'Change',
  ci: 'Configuration item',
  known_error: 'Known error',
  problem: 'Earlier problem',
};

const LOOKBACKS = [
  { value: '24', label: 'Changes in the last 24 hours' },
  { value: '72', label: 'Changes in the last 72 hours' },
  { value: '168', label: 'Changes in the last 7 days' },
  { value: '336', label: 'Changes in the last 14 days' },
];

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');

function Candidate({ candidate }: { candidate: CandidateCause }) {
  return (
    <li className="rounded-card border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CONFIDENCE_TONE[candidate.confidence]} dot>
          {candidate.score} · {candidate.confidence}
        </Badge>
        <span className="text-[12px] text-ink-muted">{KIND_LABEL[candidate.kind]}</span>
        <RecordLink record={candidate.record}>
          <span className="text-[13px] font-medium">{candidate.record.label}</span>
        </RecordLink>
      </div>
      <p className="mt-1 text-[13px] text-ink">{candidate.summary}</p>
      <ul className="mt-1 space-y-0.5 text-[12px] text-ink-muted">
        {candidate.reasons.map((r) => (
          <li key={r.text}>
            {r.text}
            {r.points ? <span className="ms-1 tabular-nums">(+{r.points})</span> : null}
          </li>
        ))}
      </ul>
      {candidate.related.length ? (
        <p className="mt-1 text-[12px] text-ink-muted">
          See{' '}
          {candidate.related.slice(0, 5).map((r, i) => (
            <span key={`${r.class}:${r.id}`}>
              {i ? ', ' : ''}
              <RecordLink record={r}>{r.label}</RecordLink>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="rounded-card border border-line px-3 py-2" open={count > 0 && count <= 5}>
      <summary className="cursor-pointer text-[13px] font-medium text-ink">
        {title} <span className="text-ink-muted">({count})</span>
      </summary>
      <div className="mt-2 text-[13px]">{count ? children : <p className="text-ink-muted">None found.</p>}</div>
    </details>
  );
}

function Details({ e }: { e: RcaEvidence }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Section title="Changes before the first incident" count={e.changes.length}>
        <ul className="space-y-1">
          {e.changes.map((c) => (
            <li key={c.id}>
              <RecordLink record={c}>{c.ref}</RecordLink> {c.title}{' '}
              <span className="text-ink-muted">
                · {when(c.startDate)} → {when(c.endDate)} · {c.cis.map((x) => `${x.name} (${x.role})`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Configuration items" count={e.cis.length}>
        <ul className="space-y-1">
          {e.cis.map((c) => (
            <li key={c.id}>
              <RecordLink record={c}>{c.name}</RecordLink>{' '}
              <span className="text-ink-muted">
                · {c.role}
                {c.via ? ` of ${c.via}` : ''}
                {c.role === 'affected' ? ` · ${c.incidentCount} incident${c.incidentCount === 1 ? '' : 's'}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Linked incidents" count={e.linkedIncidents.length}>
        <ul className="space-y-1">
          {e.linkedIncidents.map((i) => (
            <li key={i.id}>
              <RecordLink record={{ class: 'Incident', id: i.id }}>{i.ref}</RecordLink> {i.title}{' '}
              <span className="text-ink-muted">· {when(i.startDate)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Similar incidents" count={e.similarIncidents.length}>
        <ul className="space-y-1">
          {e.similarIncidents.map((i) => (
            <li key={i.id}>
              <RecordLink record={{ class: 'Incident', id: i.id }}>{i.ref}</RecordLink> {i.title}{' '}
              <span className="text-ink-muted">
                · {i.matches.join(', ')}
                {i.problemRef ? ` · already on ${i.problemRef}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Earlier problems" count={e.problems.length}>
        <ul className="space-y-1">
          {e.problems.map((p) => (
            <li key={p.id}>
              <RecordLink record={{ class: 'Problem', id: p.id }}>{p.ref}</RecordLink> {p.title}
              {p.rootCause ? <span className="block text-ink-muted">Root cause: {p.rootCause}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Known errors" count={e.knownErrors.length}>
        <ul className="space-y-1">
          {e.knownErrors.map((k) => (
            <li key={k.id}>
              <RecordLink record={{ class: 'KnownError', id: k.id }}>{k.name}</RecordLink>{' '}
              <span className="text-ink-muted">· {k.cis.map((c) => c.name).join(', ')}</span>
              {k.workaround ? <span className="block text-ink-muted">Workaround: {k.workaround}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/**
 * The correlation assistant: likely causes, ranked by a published rule, and
 * the records behind them. Everything shown is something the user can open.
 */
export function RcaEvidenceSection({
  id,
  lookbackHours,
  onLookbackChange,
}: {
  id: string;
  lookbackHours: number | undefined;
  onLookbackChange: (hours: number) => void;
}) {
  const evidence = useRcaEvidence(id, lookbackHours);
  const [showAll, setShowAll] = useState(false);
  const e = evidence.data;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Evidence & likely causes"
        subtitle={
          e
            ? `Measured from ${e.anchor.ref}, ${when(e.anchor.at)}. Only records you can open are used.`
            : 'Gathered from the incidents, CIs, changes and known errors you can open.'
        }
        action={
          <Select
            aria-label="Look-back for changes"
            className="w-60"
            options={LOOKBACKS}
            value={String(lookbackHours ?? e?.lookbackHours ?? 72)}
            onChange={(ev) => onLookbackChange(Number(ev.target.value))}
          />
        }
      />
      <CardBody className="space-y-3">
        {evidence.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {evidence.isError ? (
          <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
            {evidence.error instanceof Error ? evidence.error.message : 'The evidence could not be gathered.'}
          </div>
        ) : null}
        {e ? (
          <>
            {e.unavailable.length ? (
              <div role="status" className="rounded-card border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink">
                Partial picture: you cannot read {e.unavailable.map((u) => u.source).join(', ')}.
              </div>
            ) : null}
            {e.candidates.length ? (
              <>
                <ol className="space-y-2" aria-label="Likely causes">
                  {(showAll ? e.candidates : e.candidates.slice(0, 3)).map((c) => (
                    <Candidate key={`${c.kind}:${c.record.id}`} candidate={c} />
                  ))}
                </ol>
                {e.candidates.length > 3 ? (
                  <button type="button" className="text-[13px] text-brand-ink hover:underline" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? 'Show fewer' : `Show all ${e.candidates.length} candidates`}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                <Search className="size-4" /> No likely cause stands out yet. Link the problem's incidents and CIs for more evidence.
              </p>
            )}
            <p className="text-[12px] text-ink-muted">
              Scores add up the points shown: timing of a change before the first incident (up to 40), the CIs the
              incidents share (up to 35 for a change, 45 for the CI itself), and links iTop already records (up to 25).
            </p>
            <Details e={e} />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
