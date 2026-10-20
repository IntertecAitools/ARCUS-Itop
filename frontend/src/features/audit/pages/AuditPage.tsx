import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Play, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, Card, CardHeader, Tabs } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { useAuditOverview, useAuditRuns, useRunAudit, type RunTarget } from '../api/audit.api';
import { describeRule, formatPercent, plural, STATUS_LABEL, STATUS_TONE } from '../lib/runs';
import type { AuditCategory, AuditRule, CategoryRun, RuleResult } from '../types';

const targetKey = (t: RunTarget) => `${t.kind}:${t.id}`;

const errorNote = (e: unknown) => (
  <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
    {e instanceof Error ? e.message : 'This could not be loaded.'}
  </div>
);

/**
 * iTop's data-quality audit: each category checks a set of records against
 * its rules. Running it counts, per rule, the records that fail; each count
 * opens the list of those records.
 */
export function AuditPage() {
  const overview = useAuditOverview();
  const { data: runs = {} } = useAuditRuns();
  const run = useRunAudit();
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [domain, setDomain] = useState<string>('all');

  const start = async (targets: RunTarget[]) => {
    setRunning((s) => new Set([...s, ...targets.map(targetKey)]));
    // One after another: each run already makes several calls to iTop.
    for (const t of targets) {
      await run.mutateAsync(t).catch(() => undefined);
      setRunning((s) => {
        const next = new Set(s);
        next.delete(targetKey(t));
        return next;
      });
    }
  };

  const domains = overview.data?.domains ?? [];
  const categories = (overview.data?.categories ?? []).filter(
    (c) => domain === 'all' || c.domains.includes(Number(domain)),
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Audit' }]}
        title="Audit"
        description="Data-quality checks on the CMDB. Each category checks a set of records against its rules."
        actions={
          categories.length ? (
            <Button
              size="sm"
              leadingIcon={<Play className="size-4" aria-hidden />}
              loading={categories.some((c) => running.has(targetKey({ kind: 'category', id: c.id })))}
              onClick={() => start(categories.map((c) => ({ kind: 'category', id: c.id })))}
            >
              Run all
            </Button>
          ) : null
        }
      />

      {domains.length ? (
        <Tabs
          className="mb-4"
          value={domain}
          onChange={setDomain}
          items={[
            { id: 'all', label: 'All', count: overview.data?.categories.length },
            ...domains.map((d) => ({ id: String(d.id), label: d.name, count: d.categories.length })),
          ]}
        />
      ) : null}

      {overview.isError ? errorNote(overview.error) : null}
      {run.error ? errorNote(run.error) : null}

      {overview.isLoading ? (
        <Card className="h-40 animate-pulse" aria-busy />
      ) : categories.length === 0 && !overview.isError ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title="No audit categories"
            description="Audit categories and rules have not been set up yet."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              run={runs[category.id]}
              isRunning={(t) => running.has(targetKey(t))}
              onRun={(t) => void start([t])}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface CategoryCardProps {
  category: AuditCategory;
  run: CategoryRun | undefined;
  isRunning: (t: RunTarget) => boolean;
  onRun: (t: RunTarget) => void;
}

function CategoryCard({ category, run, isRunning, onRun }: CategoryCardProps) {
  const [open, setOpen] = useState<number | null>(null);
  const runningAll = isRunning({ kind: 'category', id: category.id });

  const subtitle = run
    ? run.summary
      ? `${plural(run.summary.failing, 'record')} of ${run.total.toLocaleString()} fail at least one rule · ${formatPercent(run.summary.percentOk)} OK · run ${new Date(run.ranAt).toLocaleString()}`
      : `${plural(run.total, 'record')} checked · run ${new Date(run.ranAt).toLocaleString()}`
    : `Checks ${category.recordTypeLabel || 'records'} · ${plural(category.rules.length, 'rule')} · not run yet`;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {category.name}
            {run?.summary ? (
              <Badge size="sm" dot tone={STATUS_TONE[run.summary.status]}>
                {STATUS_LABEL[run.summary.status]}
              </Badge>
            ) : null}
          </span>
        }
        subtitle={subtitle}
        action={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Play className="size-4" aria-hidden />}
            loading={runningAll}
            disabled={category.rules.length === 0}
            onClick={() => onRun({ kind: 'category', id: category.id })}
          >
            Run
          </Button>
        }
      />
      {category.description ? (
        <p className="-mt-1 px-5 pb-3 text-[13px] text-ink-muted">{category.description}</p>
      ) : null}
      {run?.error ? <div className="px-5 pb-3">{errorNote(new Error(run.error))}</div> : null}

      {category.rules.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-[13px] text-ink-muted">This category has no rules.</p>
      ) : (
        <table className="w-full border-t border-line text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-muted">
              <th className="px-5 py-2 font-medium">Rule</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Failing</th>
              <th className="w-24 px-3 py-2 text-right font-medium">OK</th>
              <th className="w-32 px-3 py-2 font-medium">Status</th>
              <th className="w-20 px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {category.rules.map((rule) => (
              <RuleRows
                key={rule.id}
                rule={rule}
                recordTypeLabel={category.recordTypeLabel}
                result={run?.rules[rule.id]}
                open={open === rule.id}
                onToggle={() => setOpen(open === rule.id ? null : rule.id)}
                running={runningAll || isRunning({ kind: 'rule', id: rule.id })}
                onRun={() => onRun({ kind: 'rule', id: rule.id })}
              />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

interface RuleRowsProps {
  rule: AuditRule;
  recordTypeLabel: string;
  result: RuleResult | undefined;
  open: boolean;
  onToggle: () => void;
  running: boolean;
  onRun: () => void;
}

function RuleRows({ rule, recordTypeLabel, result, open, onToggle, running, onRun }: RuleRowsProps) {
  const canOpen = Boolean(result && !result.error && result.failing > 0);
  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="px-5 py-2.5">
          <div className="font-medium text-ink">{rule.name}</div>
          <div className="text-[12px] text-ink-muted">{rule.description || describeRule(rule, recordTypeLabel)}</div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {!result ? (
            <span className="text-ink-muted">—</span>
          ) : result.error ? (
            <span className="text-critical-ink">Error</span>
          ) : canOpen ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
              {result.failing.toLocaleString()}
            </button>
          ) : (
            '0'
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {result && !result.error ? formatPercent(result.percentOk) : <span className="text-ink-muted">—</span>}
        </td>
        <td className="px-3 py-2.5">
          {result ? (
            result.error ? (
              <span className="text-[12px] text-critical-ink">{result.error}</span>
            ) : (
              <Badge size="sm" dot tone={STATUS_TONE[result.status]}>
                {STATUS_LABEL[result.status]}
              </Badge>
            )
          ) : null}
        </td>
        <td className="px-5 py-2 text-right">
          <Button size="sm" variant="ghost" loading={running} onClick={onRun} aria-label={`Run ${rule.name}`}>
            Run
          </Button>
        </td>
      </tr>
      {open && result ? (
        <tr>
          <td colSpan={5} className="bg-canvas px-5 pt-1 pb-3">
            <ul className={cn('grid gap-x-6 gap-y-1 py-2 sm:grid-cols-2 lg:grid-cols-3')}>
              {result.records.map((r) => (
                <li key={`${r.class}:${r.id}`} className="truncate">
                  <Link to={`/records/${r.class}/${r.id}`} className="text-brand-ink hover:underline">
                    {r.name}
                  </Link>
                </li>
              ))}
            </ul>
            {result.truncated ? (
              <p className="text-[12px] text-ink-muted">
                Showing the first {plural(result.records.length, 'record')} of {result.failing.toLocaleString()}.
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
