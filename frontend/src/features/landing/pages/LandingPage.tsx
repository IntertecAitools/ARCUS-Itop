import { useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  BellRing,
  Boxes,
  Building2,
  Check,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  GitPullRequest,
  Globe,
  KeyRound,
  LifeBuoy,
  Mail,
  Menu,
  MessageSquare,
  Network,
  Plus,
  Search,
  Siren,
  Sparkles,
  Star,
  Timer,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { Logo } from '@/components/layout';
import { buttonClasses } from '@/components/ui';
import { Chip, PublicTheme, PublicThemeToggle, Reveal, SkipLink, useInView } from '@/components/public';
import { useSession } from '@/features/auth';
import { HOME_PATH } from '@/config/modules';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';
import { DashboardMock } from '../components/DashboardMock';
import { ActivityFeedWidget, MetricTilesWidget, SlaFlowWidget } from '../components/LiveWidgets';

/** Sign-in first, then straight on to the portal screen the visitor asked for. */
const viaSignIn = (path: string) => `/login?next=${encodeURIComponent(path)}`;
const RAISE = viaSignIn('/portal/new');

const NAV = [
  { href: '#solutions', label: 'Solutions' },
  { href: '#features', label: 'Features' },
  { href: '#integrations', label: 'Integrations' },
  { href: '#editions', label: 'Editions' },
  { href: '#help', label: 'Help' },
];

/* --------------------------------------------------------------------------
   Shared bits
   ----------------------------------------------------------------------- */

/** Centred section heading: chip, title, subline. */
function SectionHead({
  chip,
  title,
  sub,
  id,
  align = 'center',
}: {
  chip: string;
  title: ReactNode;
  sub?: ReactNode;
  id?: string;
  align?: 'center' | 'start';
}) {
  const center = align === 'center';
  return (
    <Reveal className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <Chip>{chip}</Chip>
      <h2 id={id} className="display mt-5 text-[32px] text-ink sm:text-[44px]">
        {title}
      </h2>
      {sub ? <p className="mt-4 text-[16px] leading-7 text-ink-secondary">{sub}</p> : null}
    </Reveal>
  );
}

/** Initials in a gradient disc: our stand-in for people photos. */
function Face({ initials, hue = 0, className }: { initials: string; hue?: number; className?: string }) {
  const grads = [
    'from-brand to-info',
    'from-warning to-brand',
    'from-info to-good',
    'from-serious to-brand',
    'from-good to-info',
  ];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-white ring-2 ring-canvas',
        grads[hue % grads.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

const Stars = () => (
  <span className="flex text-warning" aria-hidden>
    {Array.from({ length: 5 }, (_, i) => (
      <Star key={i} className="size-3.5 fill-current" />
    ))}
  </span>
);

/* --------------------------------------------------------------------------
   Header and footer
   ----------------------------------------------------------------------- */

function LandingHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <Link to="/" aria-label={`${env.appName} ${env.platformName}, home`} className="me-auto lg:me-0 lg:flex-1">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="text-[14px] text-ink-secondary transition-colors hover:text-ink">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-2 lg:flex-1">
          <PublicThemeToggle />
          <Link to="/login" className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'hidden px-4 md:inline-flex' })}>
            Sign in
          </Link>
          <Link to={RAISE} className={buttonClasses({ size: 'lg', className: 'hidden px-4 md:inline-flex' })}>
            Raise a request
          </Link>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-control text-ink lg:hidden"
            aria-expanded={open}
            aria-controls="landing-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="landing-menu" aria-label="Main" className="flex flex-col gap-1 border-t border-line px-5 py-4 lg:hidden">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="rounded-control px-3 py-2.5 text-[15px] text-ink-secondary hover:bg-surface-hover hover:text-ink"
            >
              {n.label}
            </a>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/login" className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
              Sign in
            </Link>
            <Link to={RAISE} className={buttonClasses({ size: 'lg' })}>
              Raise a request
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function LandingFooter() {
  const link = 'block text-ink-secondary transition-colors hover:text-ink';
  return (
    <footer className="overflow-hidden border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 pt-16 pb-6 sm:px-8 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-[14px] leading-6 text-ink-secondary">
            The service desk for everyone at {env.appName}: incidents, requests, changes and answers in one calm place.
          </p>
        </div>
        <nav aria-label="Get help" className="space-y-3 text-[14px]">
          <p className="mb-4 text-[14px] font-semibold text-ink">Get help</p>
          <Link to={RAISE} className={link}>Raise a request</Link>
          <Link to={viaSignIn('/portal/requests')} className={link}>My requests</Link>
          <Link to={viaSignIn('/portal/help')} className={link}>Help articles</Link>
        </nav>
        <nav aria-label="Account" className="space-y-3 text-[14px]">
          <p className="mb-4 text-[14px] font-semibold text-ink">Account</p>
          <Link to="/login" className={link}>Sign in</Link>
          <Link to="/forgot-password" className={link}>Forgot password</Link>
        </nav>
      </div>
      <div aria-hidden className="mx-auto max-w-7xl px-5 sm:px-8">
        <p className="footer-wordmark text-center text-[18vw] leading-[0.85] font-semibold tracking-[-0.06em] uppercase select-none lg:text-[260px]">
          {env.appName}
        </p>
      </div>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-6 text-[13px] text-ink-muted sm:px-8">
        <span>
          © {new Date().getFullYear()} {env.appName} · {env.platformName}
        </span>
        <PublicThemeToggle />
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------------------
   Hero
   ----------------------------------------------------------------------- */

// Deterministic star field, so the hero renders the same every time.
const STARS = Array.from({ length: 38 }, (_, i) => ({
  left: (i * 37.7) % 100,
  top: (i * 23.3) % 100,
  size: i % 7 === 0 ? 3 : i % 3 === 0 ? 1.5 : 2,
  delay: (i % 9) * 0.45,
  dur: 3 + (i % 5),
}));

const HEADLINE = 'Run every service request from one command center';

function Hero() {
  const [mockRef, mockIn] = useInView<HTMLDivElement>('0px');
  const [titleRef, titleIn] = useInView<HTMLHeadingElement>('0px');
  return (
    <section className="relative overflow-hidden pt-16 sm:pt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {STARS.map((s, i) => (
          <span
            key={i}
            className="star"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              ['--twinkle-delay' as string]: `${s.delay}s`,
              ['--twinkle' as string]: `${s.dur}s`,
            }}
          />
        ))}
        <div className="hero-arc" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <Reveal>
            <a
              href="#solutions"
              className="inline-flex items-center gap-2 rounded-control border border-line bg-surface/70 p-1 pe-3 text-[13px] font-medium text-ink backdrop-blur transition-colors hover:border-brand/50"
            >
              <span className="btn-brand rounded-md bg-brand px-2 py-0.5 text-[12px] text-on-brand">New</span>
              SLA clocks that follow business hours
            </a>
          </Reveal>

          {/* Word by word: each one fades up out of a blur, a beat after the last. */}
          <h1 ref={titleRef} className="display mt-7 text-[40px] leading-[1.1] text-ink sm:text-[56px] lg:text-[64px]">
            {HEADLINE.split(' ').map((w, i) => (
              <span
                key={i}
                className={cn('reveal inline-block', titleIn && 'is-in')}
                style={{ ['--reveal-delay' as string]: `${120 + i * 70}ms` }}
              >
                {w}&nbsp;
              </span>
            ))}
          </h1>

          <Reveal delay={700}>
            <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-7 text-ink-secondary sm:text-[18px]">
              {env.appName} {env.platformName} brings incidents, requests, approvals, problems and changes into one
              workspace, with SLAs that keep themselves honest and a portal every employee can use.
            </p>
          </Reveal>

          <Reveal delay={850} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to={RAISE} className={buttonClasses({ size: 'lg', className: 'h-11 px-6 text-[14px]' })}>
              Raise a request
            </Link>
            <Link to="/login" className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'h-11 px-6 text-[14px]' })}>
              Sign in
            </Link>
          </Reveal>

          <Reveal delay={1000} className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-ink-secondary">
            <span className="flex -space-x-2">
              <Face initials="LA" hue={0} className="size-7" />
              <Face initials="OK" hue={1} className="size-7" />
              <Face initials="PS" hue={2} className="size-7" />
            </span>
            <Stars />
            <span>Agents, approvers and every employee</span>
          </Reveal>
        </div>

        <div ref={mockRef} className={cn('mockup-in relative mx-auto mt-16 max-w-5xl pb-10', mockIn && 'is-in')}>
          <DashboardMock />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-canvas" />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Logo marquee
   ----------------------------------------------------------------------- */

// Invented organisations with simple generated marks: placeholders until
// real customer logos (with permission) replace them.
const ORGS = [
  { name: 'Northgate', mark: 'circle' },
  { name: 'Halcyon', mark: 'square' },
  { name: 'Meridian', mark: 'tri' },
  { name: 'Orbitline', mark: 'ring' },
  { name: 'Tessel', mark: 'diamond' },
  { name: 'Alderbank', mark: 'bars' },
  { name: 'Quayside', mark: 'circle' },
  { name: 'Lumen Health', mark: 'ring' },
] as const;

function OrgMark({ mark }: { mark: (typeof ORGS)[number]['mark'] }) {
  const common = { fill: 'currentColor' };
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      {mark === 'circle' && <circle cx="10" cy="10" r="8" {...common} />}
      {mark === 'square' && <rect x="3" y="3" width="14" height="14" rx="4" {...common} />}
      {mark === 'tri' && <path d="M10 2 18 17H2Z" {...common} />}
      {mark === 'ring' && <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="3" />}
      {mark === 'diamond' && <path d="M10 1 19 10 10 19 1 10Z" {...common} />}
      {mark === 'bars' && (
        <g {...common}>
          <rect x="2" y="9" width="4" height="9" rx="1" />
          <rect x="8" y="5" width="4" height="13" rx="1" />
          <rect x="14" y="1" width="4" height="17" rx="1" />
        </g>
      )}
    </svg>
  );
}

function Marquee({ children, duration = '40s', className }: { children: ReactNode; duration?: string; className?: string }) {
  return (
    <div className={cn('marquee overflow-hidden', className)}>
      <div className="marquee-track" style={{ ['--marquee-duration' as string]: duration }}>
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

function TrustedBy() {
  return (
    <section aria-label="Organisations" className="relative pb-20">
      <Reveal>
        <p className="text-center text-[15px] font-medium text-ink">
          Built for IT teams in banks, hospitals, logistics and government
        </p>
      </Reveal>
      <Marquee className="mx-auto mt-8 max-w-5xl">
        {ORGS.map((o) => (
          <span key={o.name} className="mx-8 inline-flex items-center gap-2 text-[17px] font-semibold text-ink-muted">
            <OrgMark mark={o.mark} />
            {o.name}
          </span>
        ))}
      </Marquee>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Solutions: three cards with live widgets
   ----------------------------------------------------------------------- */

function Solutions() {
  const cards = [
    {
      widget: <SlaFlowWidget />,
      title: 'SLAs that act on their own',
      body: 'Clocks run on business hours, pause while you wait on the caller, and escalate before a breach, not after.',
    },
    {
      widget: <ActivityFeedWidget />,
      title: 'Every hand-off, as it happens',
      body: 'Assignments, approvals, CAB decisions and root causes land in one feed, so nobody chases a status update.',
    },
    {
      widget: <MetricTilesWidget />,
      title: 'Numbers you can steer by',
      body: 'Time to own, time to resolve and SLA compliance by team and service, live, with the trend beside it.',
    },
  ];
  return (
    <section id="solutions" aria-labelledby="solutions-heading" className="scroll-mt-16 border-y border-line bg-surface py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          chip="Solutions"
          id="solutions-heading"
          title="Turn a noisy inbox into a calm service desk"
          sub="One place where tickets are triaged, owned and closed on time, with the context every agent needs already attached."
        />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 120}>
              <div className="lift glass h-full rounded-card border border-line bg-canvas p-3">
                {c.widget}
                <div className="px-2 pt-5 pb-3">
                  <h3 className="text-[17px] font-semibold text-ink">{c.title}</h3>
                  <p className="mt-2 text-[14px] leading-6 text-ink-secondary">{c.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Bento: violet-glow panels with list cards
   ----------------------------------------------------------------------- */

const QUEUE = [
  { name: 'Layla Ahmed', team: 'Network', open: 6, sla: '4m', hue: 0 },
  { name: 'Omar Khan', team: 'Service desk', open: 11, sla: '12m', hue: 1 },
  { name: 'Priya Shah', team: 'Applications', open: 4, sla: '31m', hue: 2 },
];

const PIPELINE = [
  { step: 'Requested', pct: 100 },
  { step: 'Risk assessed', pct: 86 },
  { step: 'CAB review', pct: 64 },
  { step: 'Scheduled', pct: 41 },
];

function QueueCard() {
  return (
    <div aria-hidden className="glass rounded-2xl border border-line bg-surface p-4 text-[12px]">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-ink">Who has what</p>
        <span className="text-ink-muted">Open · next SLA</span>
      </div>
      {QUEUE.map((q) => (
        <div key={q.name} className="flex items-center gap-3 border-t border-line py-2.5">
          <Face initials={q.name.split(' ').map((p) => p[0]).join('')} hue={q.hue} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink">{q.name}</p>
            <p className="text-[11px] text-ink-muted">{q.team}</p>
          </div>
          <span className="rounded-md bg-surface-raised px-2 py-0.5 tabular-nums">{q.open}</span>
          <span className="w-10 text-end text-brand-ink tabular-nums">{q.sla}</span>
        </div>
      ))}
    </div>
  );
}

function PipelineCard() {
  return (
    <div aria-hidden className="glass rounded-2xl border border-line bg-surface p-4 text-[12px]">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-ink">Change pipeline</p>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-ink">This week</span>
      </div>
      <div className="space-y-3">
        {PIPELINE.map((p, i) => (
          <div key={p.step}>
            <div className="flex justify-between">
              <span className="text-ink-secondary">{p.step}</span>
              <span className="font-medium text-ink tabular-nums">{p.pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-grid">
              <div
                className="fill-bar h-full rounded-full bg-[image:var(--arcus-brand-gradient)]"
                style={{ width: `${p.pct}%`, animationDelay: `${i * 150}ms` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bento() {
  const mini = [
    { icon: Zap, title: 'Smart dispatch', body: 'Tickets route to the right team on arrival.' },
    { icon: Workflow, title: 'Guided changes', body: 'Risk, CAB and schedule in one flow.' },
  ];
  const checks = ['Fewer handovers, fewer dropped tickets.', 'Live SLA clocks on every queue.', 'Root causes captured once, reused forever.'];
  return (
    <section aria-labelledby="bento-heading" className="py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <Chip>Service teams</Chip>
          <h2 id="bento-heading" className="display mt-5 text-[32px] text-ink sm:text-[44px]">
            Built for teams that keep the lights on
          </h2>
          <p className="mt-4 max-w-lg text-[16px] leading-7 text-ink-secondary">
            Every screen is shaped around the next action: who owns it, how long is left, and what is blocking it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login" className={buttonClasses({ size: 'lg', className: 'h-11 px-5' })}>
              Open the desk
            </Link>
            <a href="#features" className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'h-11 px-5' })}>
              See features
            </a>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {mini.map(({ icon: Icon, title, body }) => (
              <div key={title} className="lift glass rounded-2xl border border-line bg-surface p-4">
                <Icon className="size-4 text-brand-ink" aria-hidden />
                <p className="mt-3 text-[15px] font-semibold text-ink">{title}</p>
                <p className="mt-1 text-[13px] text-ink-secondary">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={150}>
          <div className="violet-panel grid gap-4 rounded-card border border-line p-6 sm:p-8">
            <div className="float">
              <QueueCard />
            </div>
            <PipelineCard />
          </div>
        </Reveal>
      </div>

      <div className="mx-auto mt-24 grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:items-center">
        <Reveal className="lg:order-2">
          <Chip>Less noise</Chip>
          <h2 className="display mt-5 text-[32px] text-ink sm:text-[44px]">Clear signal. Faster fixes.</h2>
          <p className="mt-4 max-w-lg text-[16px] leading-7 text-ink-secondary">
            Duplicate alerts fold into one major incident, related tickets link to their problem, and the fix becomes a
            help article your users can find themselves.
          </p>
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {checks.map((c) => (
              <li key={c} className="flex items-center gap-3 py-4 text-[15px] text-ink">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                  <Check className="size-3" aria-hidden />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={150} className="lg:order-1">
          <div className="violet-panel rounded-card border border-line p-6 sm:p-8">
            <div aria-hidden className="glass rounded-2xl border border-line bg-surface p-4 text-[12px]">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold text-ink">Major incident · I-001284</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-2 py-0.5 text-[10px] font-semibold text-critical-ink">
                  <Siren className="size-3" /> Bridge open
                </span>
              </div>
              {[
                ['Linked incidents', '14', 'from 3 sites'],
                ['Probable cause', 'Cert expiry', 'P-000058'],
                ['Time on bridge', '00:42', 'target 01:00'],
                ['Users told', '1,240', 'via portal banner'],
              ].map(([k, v, s]) => (
                <div key={k} className="flex items-center justify-between border-t border-line py-2.5">
                  <span className="text-ink-secondary">{k}</span>
                  <span className="text-end">
                    <span className="block font-semibold text-ink tabular-nums">{v}</span>
                    <span className="text-[10px] text-ink-muted">{s}</span>
                  </span>
                </div>
              ))}
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-brand-ink">
                <Sparkles className="size-3.5" /> Suggested fix found in 2 past problems
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Features grid
   ----------------------------------------------------------------------- */

const FEATURES = [
  { icon: Siren, title: 'Incidents & major incidents', body: 'Triage, assign and resolve, then run a bridge when one outage hits hundreds of people.' },
  { icon: ClipboardCheck, title: 'Request catalogue & approvals', body: 'Forms per service, approvals by role or manager, and fulfilment that tracks itself.' },
  { icon: Search, title: 'Problems & root cause', body: 'Group repeat incidents, record the root cause and the workaround, and stop the next one.' },
  { icon: GitPullRequest, title: 'Changes & CAB', body: 'Risk-assessed changes, CAB review and a calendar that shows what is landing when.' },
  { icon: Timer, title: 'SLAs & business hours', body: 'Response and resolution targets per priority, on each team’s calendar and holidays.' },
  { icon: Boxes, title: 'CMDB', body: 'Servers, apps, contracts and who depends on them, linked to every ticket that touches them.' },
  { icon: LifeBuoy, title: 'Self-service portal', body: 'Employees raise requests, follow progress and find answers without calling anyone.' },
  { icon: KeyRound, title: 'Single sign-on & MFA', body: 'Sign in with Microsoft Entra ID or a password plus an authenticator code.' },
  { icon: Building2, title: 'Multi-tenancy', body: 'Several organisations on one desk, each seeing only its own people and tickets.' },
];

function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-16 border-y border-line bg-surface py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          chip="Features"
          id="features-heading"
          title="Every ITSM process, one product"
          sub="From the first email to the post-incident review, each step lives in the same place and speaks the same language."
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 100}>
              <div className="lift glass h-full rounded-card border border-line bg-canvas p-6">
                <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand/30 bg-brand-soft text-brand-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-[17px] font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-[14px] leading-6 text-ink-secondary">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Stories carousel
   ----------------------------------------------------------------------- */

// Illustrative stories: swap for real, attributed customer quotes when there are some.
const STORIES = [
  {
    quote: 'Our P1s are owned in minutes, not hours.',
    body: 'Clocks that follow our shifts and an escalation that fires on its own took the guesswork out of nights and weekends.',
    who: 'IT operations lead',
    initials: 'IO',
  },
  {
    quote: 'Employees stopped emailing us “any update?”',
    body: 'The portal shows them exactly where their request is, so the service desk spends its time fixing things instead.',
    who: 'Service desk manager',
    initials: 'SD',
  },
  {
    quote: 'CAB went from an hour to fifteen minutes.',
    body: 'Risk, impact and the change calendar are on one screen, so the board decides instead of hunting for context.',
    who: 'Change manager',
    initials: 'CM',
  },
];

function Stories() {
  const [i, setI] = useState(0);
  const s = STORIES[i]!;
  const go = (d: number) => setI((x) => (x + d + STORIES.length) % STORIES.length);
  return (
    <section aria-labelledby="stories-heading" className="py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.4fr]">
        <Reveal className="flex flex-col">
          <Chip className="self-start">Stories</Chip>
          <h2 id="stories-heading" className="mt-5 max-w-sm text-[22px] leading-8 font-medium text-ink">
            What changes when the whole desk works in one place.
          </h2>
          <div className="mt-8 flex gap-3 lg:mt-auto">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous story"
              className="btn-brand inline-flex size-11 items-center justify-center rounded-full bg-brand text-on-brand"
            >
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next story"
              className="btn-brand inline-flex size-11 items-center justify-center rounded-full bg-brand text-on-brand"
            >
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <figure key={i} aria-live="polite" className="feed-in">
            <MessageSquare className="size-6 text-brand-ink" aria-hidden />
            <blockquote className="display mt-6 text-[36px] text-ink sm:text-[52px]">{s.quote}</blockquote>
            <p className="mt-6 max-w-xl text-[16px] leading-7 text-ink-secondary">{s.body}</p>
            <figcaption className="mt-8 flex items-center gap-3 text-[14px] text-ink-secondary">
              <Face initials={s.initials} hue={i} className="size-11 text-[13px]" />
              {s.who}
            </figcaption>
          </figure>
          <div className="mt-8 flex gap-2" aria-hidden>
            {STORIES.map((_, n) => (
              <span key={n} className={cn('h-1 rounded-full transition-all', n === i ? 'w-8 bg-brand' : 'w-4 bg-line')} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Integrations
   ----------------------------------------------------------------------- */

const INTEGRATIONS = [
  { icon: Mail, name: 'Email to ticket', body: 'Every message to the desk becomes a ticket.' },
  { icon: KeyRound, name: 'Microsoft Entra ID', body: 'Single sign-on for staff and employees.' },
  { icon: BellRing, name: 'Microsoft Teams', body: 'P1 alerts straight into the on-call channel.' },
  { icon: MessageSquare, name: 'Slack', body: 'Route updates to the right channel.' },
  { icon: Database, name: 'iTop', body: 'A proven CMDB and record store underneath.' },
  { icon: Users, name: 'LDAP / Active Directory', body: 'People and teams kept in sync.' },
  { icon: FileSpreadsheet, name: 'Data import', body: 'Bring CSV and scheduled syncs in, mapped.' },
  { icon: Globe, name: 'REST API', body: 'Automate anything the screens can do.' },
  { icon: AtSign, name: 'SMTP notifications', body: 'Templated emails on any state change.' },
  { icon: Network, name: 'Monitoring alerts', body: 'Turn alerts into incidents automatically.' },
];

function Integrations() {
  return (
    <section id="integrations" aria-labelledby="integrations-heading" className="scroll-mt-16 border-y border-line bg-surface py-24">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-6 px-5 sm:px-8">
        <SectionHead
          align="start"
          chip="Integrations"
          id="integrations-heading"
          title="Connects to the tools you already run"
          sub="Mail, identity, chat and your existing records plug in, so the desk fits your estate instead of the other way round."
        />
        <Reveal delay={150}>
          <Link to="/login" className={buttonClasses({ size: 'lg', className: 'h-11 px-5' })}>
            Open the desk
          </Link>
        </Reveal>
      </div>
      <Marquee duration="55s" className="mt-12">
        {INTEGRATIONS.map(({ icon: Icon, name, body }) => (
          <div key={name} className="lift glass mx-2 w-64 rounded-2xl border border-line bg-canvas p-5">
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-surface-raised text-brand-ink">
              <Icon className="size-4" aria-hidden />
            </span>
            <p className="mt-4 text-[15px] font-semibold text-ink">{name}</p>
            <p className="mt-1 text-[13px] text-ink-secondary">{body}</p>
          </div>
        ))}
      </Marquee>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Editions
   ----------------------------------------------------------------------- */

const EDITIONS = [
  {
    name: 'Essentials',
    tag: 'For a single IT team',
    blurb: 'Everything a service desk needs on day one.',
    items: ['Incidents and requests', 'Self-service portal', 'Email to ticket', 'SLA targets and reports'],
  },
  {
    name: 'Professional',
    tag: 'Most chosen',
    blurb: 'Full ITSM for teams that run changes and problems.',
    items: ['Everything in Essentials', 'Problems and root cause', 'Changes and CAB', 'Approvals and request forms'],
    highlight: true,
  },
  {
    name: 'Enterprise',
    tag: 'For groups and regulated estates',
    blurb: 'Many organisations, strict access, your own identity provider.',
    items: ['Everything in Professional', 'Multi-tenancy', 'Single sign-on and MFA', 'Audit and data sync'],
  },
];

function Editions() {
  return (
    <section id="editions" aria-labelledby="editions-heading" className="scroll-mt-16 py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead
          chip="Editions"
          id="editions-heading"
          title="Start lean, grow into the whole practice"
          sub="Every edition is the same product. Turn on more of it as your service management matures."
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {EDITIONS.map((e, i) => (
            <Reveal key={e.name} delay={i * 120}>
              <div
                className={cn(
                  'lift flex h-full flex-col rounded-card border p-7',
                  e.highlight ? 'violet-sweep border-brand/50 shadow-[var(--arcus-glow)]' : 'glass border-line bg-surface',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[20px] font-semibold text-ink">{e.name}</h3>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-medium',
                      e.highlight ? 'bg-brand text-on-brand' : 'bg-surface-raised text-ink-secondary',
                    )}
                  >
                    {e.tag}
                  </span>
                </div>
                <p className="mt-3 text-[15px] leading-6 text-ink-secondary">{e.blurb}</p>
                <ul className="mt-6 flex-1 space-y-3 border-t border-line pt-6">
                  {e.items.map((it) => (
                    <li key={it} className="flex items-center gap-2.5 text-[14px] text-ink">
                      <Check className="size-4 text-brand-ink" aria-hidden />
                      {it}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/login"
                  className={buttonClasses({
                    variant: e.highlight ? 'primary' : 'secondary',
                    size: 'lg',
                    fullWidth: true,
                    className: 'mt-8 h-11',
                  })}
                >
                  Get started
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   FAQ
   ----------------------------------------------------------------------- */

const FAQS = [
  {
    q: 'Who can use the service desk?',
    a: `Everyone with an account at ${env.appName}. Sign in to raise requests and follow the ones you have raised; IT staff work their queues in the same place.`,
  },
  {
    q: 'Which account do I sign in with?',
    a: 'The account your organisation gave you. Where single sign-on is set up, that is your usual work account.',
  },
  {
    q: 'I have forgotten my password.',
    a: 'Use “Forgot password?” on the sign-in page when it is offered. Otherwise, ask your IT team to reset it.',
  },
  {
    q: 'How will I know when my request is done?',
    a: 'Its status changes in “My requests”, and the bell in the portal tells you when there is news.',
  },
  {
    q: 'Can I see requests I raised by email?',
    a: 'Yes. Emails to the service desk become requests under your name, so they show up in “My requests” too.',
  },
  {
    q: 'Who sees what I write?',
    a: 'The IT team handling your request, and anyone it is shared with for approval. Other employees do not.',
  },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="help" aria-labelledby="help-heading" className="scroll-mt-16 border-t border-line py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.15fr]">
        <Reveal className="flex flex-col">
          <Chip className="self-start">FAQ</Chip>
          <h2 id="help-heading" className="display mt-5 text-[32px] text-ink sm:text-[44px]">
            Questions before you start
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-7 text-ink-secondary">
            More answers are in the help articles once you have signed in.
          </p>
          <div className="glass mt-10 flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center lg:mt-auto">
            <span className="flex -space-x-2">
              <Face initials="SD" hue={0} />
              <Face initials="IT" hue={2} />
              <Face initials="HD" hue={1} />
            </span>
            <p className="min-w-0 text-[14px] text-ink sm:flex-1">Still stuck? The service desk is a request away.</p>
            <Link to={RAISE} className={buttonClasses({ size: 'md' })}>
              Raise a request
            </Link>
          </div>
        </Reveal>
        <Reveal delay={150} className="space-y-2">
          {FAQS.map((f, n) => {
            const isOpen = open === n;
            return (
              <div key={f.q} className="glass rounded-2xl border border-line bg-surface">
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${n}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${n}`}
                    onClick={() => setOpen(isOpen ? null : n)}
                    className="flex w-full items-center justify-between gap-6 rounded-2xl px-5 py-4 text-start text-[15px] font-medium text-ink"
                  >
                    {f.q}
                    <span
                      className={cn(
                        'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink-secondary transition-transform duration-300',
                        isOpen && 'rotate-45 text-brand-ink',
                      )}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </span>
                  </button>
                </h3>
                <div id={`faq-a-${n}`} role="region" aria-labelledby={`faq-q-${n}`} className="accordion-panel" data-open={isOpen}>
                  <div>
                    <p className="px-5 pb-5 text-[14px] leading-6 text-ink-secondary">{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Closing call to action
   ----------------------------------------------------------------------- */

function ClosingCta() {
  return (
    <section aria-labelledby="cta-heading" className="cta-band relative overflow-hidden py-28">
      <Reveal className="relative mx-auto max-w-3xl px-5 text-center sm:px-8">
        <span className="cta-glass inline-flex items-center rounded-pill px-3 py-1.5 text-[12px] font-medium tracking-[0.08em] uppercase">
          All in one
        </span>
        <h2 id="cta-heading" className="display mt-5 text-[36px] sm:text-[56px]">
          One desk for every service
        </h2>
        <p className="cta-sub mx-auto mt-4 max-w-xl text-[16px] leading-7">
          Raise it, route it, fix it and learn from it, in one place your whole organisation already knows.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link to={RAISE} className="cta-solid inline-flex h-11 items-center rounded-control px-6 text-[14px] font-medium transition">
            Raise a request
          </Link>
          <Link to="/login" className="cta-glass inline-flex h-11 items-center rounded-control px-6 text-[14px] font-medium backdrop-blur transition">
            Sign in
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/**
 * The public front door, for visitors who are not signed in: what the
 * service desk does, and the two ways in (sign in, raise a request).
 * Someone already signed in goes straight to their own home.
 */
export function LandingPage() {
  const { data: user, isLoading } = useSession();

  if (isLoading) return <PublicTheme />;
  if (user) return <Navigate to={user.kind === 'portal' ? '/portal' : HOME_PATH} replace />;

  return (
    <PublicTheme className="overflow-x-clip">
      <SkipLink />
      <LandingHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <TrustedBy />
        <Solutions />
        <Bento />
        <Features />
        <Stories />
        <Integrations />
        <Editions />
        <Faq />
        <ClosingCta />
      </main>
      <LandingFooter />
    </PublicTheme>
  );
}
