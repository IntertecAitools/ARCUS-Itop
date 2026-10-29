import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, BellRing, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A tick every `ms`, paused while the tab is hidden. */
function useTick(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setN((x) => x + 1);
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Shared frame: a glass well inside the feature card. */
function Well({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden className={cn('glass h-56 rounded-2xl border border-line bg-surface p-4 text-[12px]', className)}>
      {children}
    </div>
  );
}

/** Automation: a P1 raises, the SLA clock runs down, escalation fires. */
export function SlaFlowWidget() {
  const tick = useTick(1000);
  const total = 30 * 60;
  const left = total - ((tick * 7) % total);
  const pct = Math.round((left / total) * 100);
  return (
    <Well className="flex flex-col items-stretch">
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3 py-2.5">
        <span className="pulse-dot size-2 rounded-full bg-brand" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">P1 incident raised</p>
          <p className="text-[11px] text-ink-muted">Trigger · Email to ticket</p>
        </div>
      </div>
      <span className="mx-auto h-5 w-px bg-gradient-to-b from-transparent via-brand to-transparent" />
      <div className="mx-6 rounded-xl border border-line bg-surface-raised px-3 py-2.5">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-ink">If time to own &lt; 30 min</p>
          <span className="font-mono text-[11px] text-brand-ink tabular-nums">{fmt(left)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-grid">
          <div
            className="h-full rounded-full bg-[image:var(--arcus-brand-gradient)] transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="mx-auto h-5 w-px bg-gradient-to-b from-transparent via-info to-transparent" />
      <div className="grid flex-1 grid-cols-2 gap-2">
        {[
          ['Escalate', 'Major incident team', Siren],
          ['Notify', 'On-call in Teams', BellRing],
        ].map(([title, sub, Icon]) => {
          const I = Icon as typeof Siren;
          return (
            <div key={title as string} className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface-raised">
              <I className="mb-1 size-3.5 text-brand-ink" />
              <p className="font-semibold text-ink">{title as string}</p>
              <p className="text-[10px] text-ink-muted">{sub as string}</p>
            </div>
          );
        })}
      </div>
    </Well>
  );
}

const EVENTS = [
  { who: 'Layla', what: 'took I-001284', note: 'VPN drops for the Riyadh office' },
  { who: 'Omar', what: 'approved R-000913', note: 'New laptop for onboarding' },
  { who: 'CAB', what: 'cleared C-000207', note: 'Firewall rule change, Fri 22:00' },
  { who: 'Priya', what: 'linked P-000058', note: 'Root cause: expired certificate' },
  { who: 'Portal', what: 'opened R-000921', note: 'Access to the finance share' },
];
const HUES = ['from-brand to-info', 'from-warning to-brand', 'from-info to-good', 'from-serious to-brand'];

/** Activity: new ticket events slide in at the top, stamped "now". */
export function ActivityFeedWidget() {
  const tick = useTick(2600);
  const items = [0, 1, 2].map((i) => EVENTS[(tick + EVENTS.length - i) % EVENTS.length]!);
  return (
    <Well>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-ink">Service desk activity</p>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-ink">Live</span>
      </div>
      <div className="space-y-2">
        {items.map((e, i) => (
          <div
            key={`${tick}-${i}`}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3 py-2',
              i === 0 && 'feed-in',
            )}
          >
            <span className={cn('size-6 shrink-0 rounded-full bg-gradient-to-br', HUES[(tick + i) % HUES.length])} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">
                {e.who} {e.what}
              </p>
              <p className="truncate text-[11px] text-ink-muted">{e.note}</p>
            </div>
            <span className={cn('shrink-0 text-[11px] font-medium', i === 0 ? 'text-info-ink' : 'text-ink-muted')}>
              {i === 0 ? 'now' : `${i * 3}m`}
            </span>
          </div>
        ))}
      </div>
    </Well>
  );
}

const BARS = [28, 44, 38, 62, 74, 90];

/** Insight: TTO met, MTTR, and a resolution trend that climbs. */
export function MetricTilesWidget() {
  return (
    <Well className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-surface-raised px-3 py-2">
          <p className="text-[20px] font-bold text-ink">98%</p>
          <p className="text-[10px] text-ink-muted">TTO met</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-raised px-3 py-2">
          <p className="text-[20px] font-bold text-ink">2.4h</p>
          <p className="text-[10px] text-ink-muted">Mean time to resolve</p>
        </div>
      </div>
      <div className="flex flex-1 items-end gap-1.5 rounded-xl border border-line bg-surface-raised px-3 pt-3 pb-2">
        {BARS.map((h, i) => (
          <span
            key={i}
            className="grow-bar flex-1 rounded-full bg-[image:var(--arcus-brand-gradient)]"
            style={{ height: `${h}%`, opacity: 0.45 + i * 0.11, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface-raised px-3 py-2">
        <div>
          <p className="font-semibold text-ink">Resolutions trending up</p>
          <p className="text-[10px] text-ink-muted">Updated a few seconds ago</p>
        </div>
        <span className="inline-flex items-center gap-0.5 text-[15px] font-bold text-brand-ink">
          +18% <ArrowUpRight className="size-3.5" />
        </span>
      </div>
    </Well>
  );
}
