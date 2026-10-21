import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FolderTree, Pencil, Play, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, buttonClasses, Card, CardHeader, Tabs } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn, friendlyDateTime } from '@/lib/utils';
import { useAuditOverview, useAuditRuns, useRunAudit, type RunTarget } from '../api/audit.api';
import { DomainsPanel } from '../components/DomainsPanel';
import { parseRunParam } from '../lib/editing';
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
 * opens the list of those records. Categories, rules and domains are edited
 * from here too; `?run=category:10` (or `rule:20`), set after "Save and run",
 * runs that check as the screen opens.
 */
export function AuditPage() {
  const overview = useAuditOverview();
  const { data: runs = {} } = useAuditRuns();
  const run = useRunAudit();
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [domain, setDomain] = useState<string>('all');
  const [editingDomains, setEditingDomains] = useState(false);
  const [params, setParams] = useSearchParams();

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

  // Run what the editor asked for, once, then forget the request.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    const target = parseRunParam(params.get('run'));
    if (!target || requested.current === params.get('run')) return;
    requested.current = params.get('run');
    setParams((p) => {
      p.delete('run');
      return p;
    }, { replace: true });
    void start([target]);
  }, [params]);

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
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<FolderTree className="size-4" aria-hidden />}
              onClick={() => setEditingDomains((v) => !v)}
            >
              Domains
            </Button>
            <Link to="/audit/categories/new" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <Plus className="me-1.5 size-4" aria-hidden />
              New category
            </Link>
            {categories.length ? (
              <Button
                size="sm"
                leadingIcon={<Play className="size-4" aria-hidden />}
                loading={categories.some((c) => running.has(targetKey({ kind: 'category', id: c.id })))}
                onClick={() => start(categories.map((c) => ({ kind: 'category', id: c.id })))}
              >
                Run all
              </Button>
            ) : null}
          </div>
        }
      />

      {editingDomains && overview.data ? (
        <DomainsPanel domains={domains} onClose={() => setEditingDomains(false)} />
      ) : null}

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
            description="A category is a set of records to check, such as every server in production; its rules say what is wrong with them."
            action={
              <Link to="/audit/categories/new" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
                New category
              </Link>
            }
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
      ? `${plural(run.summary.failing, 'record')} of ${run.total.toLocaleString()} fail at least one rule · ${formatPercent(run.summary.percentOk)} OK · run ${friendlyDateTime(run.ranAt)}`
      : `${plural(run.total, 'record')} checked · run ${friendlyDateTime(run.ranAt)}`
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
          <div className="flex gap-2">
            <Link to={`/audit/categories/${category.id}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              <Pencil className="me-1.5 size-4" aria-hidden />
              Edit
            </Link>
            <Link to={`/audit/rules/new?category=${category.id}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              <Plus className="me-1.5 size-4" aria-hidden />
              Add rule
            </Link>
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
          </div>
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
            <tr className="text-start text-[12px] text-ink-muted">
              <th className="px-5 py-2 font-medium">Rule</th>
              <th className="w-28 px-3 py-2 text-end font-medium">Failing</th>
              <th className="w-24 px-3 py-2 text-end font-medium">OK</th>
              <th className="w-32 px-3 py-2 font-medium">Status</th>
              <th className="w-32 px-5 py-2" />
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
        <td className="px-3 py-2.5 text-end tabular-nums">
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
              {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />}
              {result.failing.toLocaleString()}
            </button>
          ) : (
            '0'
          )}
        </td>
        <td className="px-3 py-2.5 text-end tabular-nums">
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
        <td className="px-5 py-2 text-end whitespace-nowrap">
          <Link
            to={`/audit/rules/${rule.id}`}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            aria-label={`Edit ${rule.name}`}
            title="Edit"
          >
            <Pencil className="size-4" aria-hidden />
          </Link>
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
