import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  GitPullRequest,
  Inbox,
  LayoutGrid,
  Search,
  ShieldCheck,
  Timer,
  Wrench,
} from 'lucide-react';
import { LogoMark } from '@/components/layout';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';

const NAV = [
  { label: 'Dashboard', icon: LayoutGrid, active: true },
  { label: 'Incidents', icon: AlertTriangle },
  { label: 'Requests', icon: Inbox },
  { label: 'Problems', icon: Wrench },
  { label: 'Changes', icon: GitPullRequest },
  { label: 'SLA', icon: Timer },
  { label: 'Reports', icon: BarChart3 },
];

const KPIS = [
  { label: 'Open incidents', value: '42', delta: '−12%', good: true, icon: AlertTriangle },
  { label: 'SLA compliance', value: '98.4%', delta: '+2.1%', good: true, icon: ShieldCheck },
  { label: 'Time to own', value: '6m', delta: '−3m', good: true, icon: Clock },
  { label: 'Resolved today', value: '128', delta: '+18%', good: true, icon: CheckCircle2 },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Load by hour × day, 0–4: a deterministic pattern so the mockup never jumps.
const HEAT = DAYS.map((_, d) => Array.from({ length: 14 }, (_, h) => (d * 7 + h * 3 + ((h * d) % 5)) % 5));

const ROWS = [
  { ref: 'I-001284', title: 'VPN drops for the Riyadh office', priority: 'P1', state: 'Assigned', tone: 'critical' },
  { ref: 'R-000913', title: 'New laptop for onboarding', priority: 'P3', state: 'Approved', tone: 'good' },
  { ref: 'I-001281', title: 'Printer queue stuck on floor 4', priority: 'P2', state: 'Pending', tone: 'warning' },
] as const;

const tone = {
  critical: 'bg-critical-soft text-critical-ink',
  good: 'bg-good-soft text-good-ink',
  warning: 'bg-warning-soft text-warning-ink',
};

/**
 * The staff dashboard in miniature, for the landing hero. Decorative: the
 * real screen is behind sign-in, so this is hidden from assistive technology.
 */
export function DashboardMock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'overflow-hidden rounded-[18px] border border-line bg-surface p-1.5 shadow-overlay select-none',
        className,
      )}
    >
      <div className="flex overflow-hidden rounded-[14px] border border-line bg-canvas text-[10px] text-ink-secondary">
        {/* Sidebar */}
        <div className="hidden w-[150px] shrink-0 flex-col border-e border-line bg-surface p-3 sm:flex">
          <div className="mb-4 flex items-center gap-2">
            <LogoMark className="h-5 w-4" />
            <span className="text-[11px] font-semibold text-ink">{env.appName}</span>
          </div>
          <div className="space-y-0.5">
            {NAV.map(({ label, icon: Icon, active }) => (
              <div
                key={label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5',
                  active ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted',
                )}
              >
                <Icon className="size-3" />
                {label}
              </div>
            ))}
          </div>
          <div className="mt-auto rounded-lg border border-line bg-surface-raised p-2.5">
            <p className="font-medium text-ink">Major incident</p>
            <p className="mt-0.5 text-ink-muted">Bridge open · 14 linked</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-grid">
              <div className="fill-bar h-full w-2/3 rounded-full bg-[image:var(--arcus-brand-gradient)]" />
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Service operations</p>
              <p className="text-ink-muted">Last 7 days · all teams</p>
            </div>
            <div className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-ink-muted md:flex">
              <Search className="size-3" /> Search tickets…
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {KPIS.map(({ label, value, delta, icon: Icon }) => (
              <div key={label} className="glass rounded-lg border border-line bg-surface p-2.5">
                <div className="flex items-center justify-between text-ink-muted">
                  {label}
                  <Icon className="size-3" />
                </div>
                <div className="mt-1.5 flex items-end justify-between">
                  <span className="text-[17px] font-semibold tracking-tight text-ink">{value}</span>
                  <span className="rounded bg-good-soft px-1 py-px text-[9px] text-good-ink">{delta}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-[1.6fr_1fr]">
            <div className="rounded-lg border border-line bg-surface p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-ink">Incident load by hour</span>
                <span className="rounded border border-line px-1.5 py-px text-ink-muted">This week</span>
              </div>
              <div className="space-y-[3px]">
                {HEAT.map((row, d) => (
                  <div key={DAYS[d]} className="flex items-center gap-[3px]">
                    <span className="w-6 text-[8px] text-ink-muted">{DAYS[d]}</span>
                    {row.map((v, h) => (
                      <span
                        key={h}
                        className="h-2.5 flex-1 rounded-[2px] bg-brand"
                        style={{ opacity: 0.1 + v * 0.22 }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-2.5">
              <p className="mb-2 font-medium text-ink">SLA at risk</p>
              {[
                ['P1 · Payments API', '12m', 85],
                ['P2 · Email relay', '48m', 55],
                ['P2 · HR portal', '1h 20m', 30],
              ].map(([name, left, pct]) => (
                <div key={name as string} className="mb-2 last:mb-0">
                  <div className="flex justify-between">
                    <span>{name}</span>
                    <span className="text-ink-muted tabular-nums">{left}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-grid">
                    <div
                      className="fill-bar h-full rounded-full bg-[image:var(--arcus-brand-gradient)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-line bg-surface p-2.5">
            <p className="mb-1.5 font-medium text-ink">Recent tickets</p>
            {ROWS.map((r) => (
              <div key={r.ref} className="flex items-center gap-3 border-t border-line py-1.5 first:border-t-0">
                <span className="w-14 shrink-0 font-medium text-ink tabular-nums">{r.ref}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="rounded border border-line px-1 text-ink-muted">{r.priority}</span>
                <span className={cn('rounded-full px-1.5 py-px', tone[r.tone])}>{r.state}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
