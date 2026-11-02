import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { Pagination, usePagedRows } from '@/components/data-display';
import { cn } from '@/lib/utils';
import { share, STATES } from '../lib/sla';
import type { SlaGroup, SlaState } from '../types';

const BAR: Record<SlaState, string> = {
  breached: 'bg-critical',
  at_risk: 'bg-warning',
  within: 'bg-good',
  none: 'bg-line',
};

interface SlaBreakdownCardProps {
  title: string;
  /** Column header for the group name, e.g. "Team". */
  noun: string;
  groups: SlaGroup[] | undefined;
  isLoading: boolean;
  /** The group (and, from a count, the state) to drill down to. */
  onPick: (key: string, state?: SlaState) => void;
  /** Key of the group currently drilled into, highlighted. */
  selected?: string | undefined;
}

/**
 * One breakdown of open tickets: a row per group with a stacked bar of its
 * SLA states. The name opens all of the group's tickets, a count only those
 * in that state.
 */
export function SlaBreakdownCard({ title, noun, groups, isLoading, onPick, selected }: SlaBreakdownCardProps) {
  const { pageRows, pagination } = usePagedRows(groups ?? [], { pageSize: 10 });
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {isLoading || !groups ? (
          <Skeleton className="h-[160px] w-full" />
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-muted">No open tickets.</p>
        ) : (
          <div className="ui-table-frame">
            <div className="overflow-x-auto">
              <table className="ui-table" aria-label={title}>
                <thead>
                  <tr>
                    <th>{noun}</th>
                    <th aria-label="Share by state" />
                    {STATES.map((s) => (
                      <th key={s.value} className="w-20 text-end" title={s.label}>
                        {s.label === 'Within target' ? 'Within' : s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((g) => (
                    <tr key={g.key || 'none'} className={cn(selected === g.key && 'bg-brand-soft/40')}>
                      <td className="max-w-[160px]">
                        <button
                          type="button"
                          className="block w-full truncate text-start text-ink hover:underline"
                          onClick={() => onPick(g.key)}
                          title={`${g.label}: ${g.total} open`}
                        >
                          {g.label}
                        </button>
                      </td>
                      <td className="w-[30%]">
                        <div className="flex h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                          {STATES.map((s) => (
                            <span key={s.value} className={BAR[s.value]} style={{ width: `${share(g[s.count], g.total)}%` }} />
                          ))}
                        </div>
                      </td>
                      {STATES.map((s) => {
                        const n = g[s.count];
                        return (
                          <td key={s.value} className="text-end tabular-nums">
                            {n ? (
                              <button
                                type="button"
                                className="text-brand-ink hover:underline"
                                onClick={() => onPick(g.key, s.value)}
                                aria-label={`${g.label}: ${n} ${s.label.toLowerCase()}`}
                              >
                                {n}
                              </button>
                            ) : (
                              <span className="text-ink-muted">0</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pagination} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
