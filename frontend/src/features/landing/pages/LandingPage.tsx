import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/layout';
import { buttonClasses } from '@/components/ui';
import {
  ArrowLink,
  CheckList,
  Eyebrow,
  PublicImage,
  PublicTheme,
  PublicThemeToggle,
  SkipLink,
} from '@/components/public';
import { publicImagery } from '@/assets/images/public';
import { useSession } from '@/features/auth';
import { HOME_PATH } from '@/config/modules';
import { env } from '@/config/env';

/** Sign-in first, then straight on to the portal screen the visitor asked for. */
const viaSignIn = (path: string) => `/login?next=${encodeURIComponent(path)}`;
const RAISE = viaSignIn('/portal/new');

const FEATURES = [
  {
    id: 'raise',
    title: 'Raise a request in minutes',
    body: 'Something broken, or something you need? Tell the IT team in your own words. No forms full of codes.',
    points: [
      'Describe the problem or what you need',
      'Say how much it is holding you up',
      'Get a reference number straight away',
    ],
    link: { to: RAISE, label: 'Raise a request' },
    image: publicImagery.hero,
  },
  {
    id: 'follow',
    title: 'Follow it to the finish',
    body: 'Every request you raise stays in one place, with its status and the whole conversation with the support team.',
    points: [
      'See where each request stands',
      'Answer questions and add details as you go',
      'Get notified when something changes',
    ],
    link: { to: viaSignIn('/portal/requests'), label: 'See my requests' },
    image: publicImagery.requests,
  },
  {
    id: 'answers',
    title: 'Find answers yourself',
    body: 'The support team writes up fixes for common questions, so you can often sort things out without waiting.',
    points: ['Search articles from the support team', 'Step-by-step answers to common problems'],
    link: { to: viaSignIn('/portal/help'), label: 'Browse help articles' },
    image: publicImagery.answers,
  },
];

const FAQS = [
  {
    q: 'Who can use the helpdesk?',
    a: `Everyone with an account at ${env.appName}. Sign in to raise requests and follow the ones you have raised.`,
  },
  {
    q: 'Which account do I sign in with?',
    a: 'The account your organisation gave you for the helpdesk. If you do not have one yet, ask your IT team.',
  },
  {
    q: 'I have forgotten my password.',
    a: 'Use “Forgot password?” on the sign-in page when it is offered. Otherwise, ask your IT team to reset it.',
  },
  {
    q: 'How will I know when my request is done?',
    a: 'Its status changes in “My requests”, and the bell in the portal tells you when there is news.',
  },
];

function LandingHeader() {
  const [open, setOpen] = useState(false);
  const links = (
    <>
      <a href="#help" className="text-[14px] text-ink-secondary hover:text-ink" onClick={() => setOpen(false)}>
        Help
      </a>
      <Link to="/login" className="text-[14px] text-ink-secondary hover:text-ink">
        Sign in
      </Link>
    </>
  );
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <Link to="/" aria-label={`${env.appName} ${env.platformName}, home`} className="me-auto">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {links}
        </nav>
        <PublicThemeToggle />
        <Link to={RAISE} className={buttonClasses({ size: 'md', className: 'hidden px-5 md:inline-flex' })}>
          Raise a request
        </Link>
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center text-ink md:hidden"
          aria-expanded={open}
          aria-controls="landing-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>
      {open ? (
        <nav id="landing-menu" aria-label="Main" className="flex flex-col gap-5 border-t border-line px-5 py-6 md:hidden">
          {links}
          <Link to={RAISE} className={buttonClasses({ size: 'lg', fullWidth: true })}>
            Raise a request
          </Link>
        </nav>
      ) : null}
    </header>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-[14px] text-ink-secondary">
            The IT helpdesk for everyone at {env.appName}.
          </p>
        </div>
        <nav aria-label="Get help" className="space-y-3 text-[14px]">
          <Eyebrow className="mb-4">Get help</Eyebrow>
          <Link to={RAISE} className="block text-ink-secondary hover:text-ink">Raise a request</Link>
          <Link to={viaSignIn('/portal/requests')} className="block text-ink-secondary hover:text-ink">My requests</Link>
          <Link to={viaSignIn('/portal/help')} className="block text-ink-secondary hover:text-ink">Help articles</Link>
        </nav>
        <nav aria-label="Account" className="space-y-3 text-[14px]">
          <Eyebrow className="mb-4">Account</Eyebrow>
          <Link to="/login" className="block text-ink-secondary hover:text-ink">Sign in</Link>
          <Link to="/forgot-password" className="block text-ink-secondary hover:text-ink">Forgot password</Link>
        </nav>
      </div>
      <div className="mx-auto max-w-7xl border-t border-line px-5 py-6 text-[13px] text-ink-muted sm:px-8">
        © {new Date().getFullYear()} {env.appName} · {env.platformName}
      </div>
    </footer>
  );
}

/**
 * The public front door, for visitors who are not signed in: what the
 * helpdesk does, and the two ways in (sign in, raise a request).
 * Someone already signed in goes straight to their own home.
 */
export function LandingPage() {
  const { data: user, isLoading } = useSession();

  if (isLoading) return <PublicTheme />;
  if (user) return <Navigate to={user.kind === 'portal' ? '/portal' : HOME_PATH} replace />;

  return (
    <PublicTheme>
      <SkipLink />
      <LandingHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section className="mx-auto max-w-7xl px-5 pt-16 pb-20 sm:px-8 md:pt-28">
          <div className="mx-auto max-w-4xl text-center">
            <Eyebrow>{env.platformName}</Eyebrow>
            <h1 className="display mt-6 text-[44px] sm:text-[64px] lg:text-[80px]">
              IT help for everyone at {env.appName}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-7 text-ink-secondary sm:text-[19px] sm:leading-8">
              Report a problem, ask for something new and follow every request until it is done — all in one place.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-10">
              <Link to="/login" className={buttonClasses({ size: 'lg', className: 'h-12 px-8 text-[14px] tracking-[0.08em] uppercase' })}>
                Sign in
              </Link>
              <ArrowLink to={RAISE}>Raise a request</ArrowLink>
            </div>
          </div>
          <PublicImage src={publicImagery.hero} className="mt-16 aspect-[3/2] w-full md:mt-24 md:aspect-[12/6]" />
        </section>

        {/* What it does: alternating rows */}
        <section aria-labelledby="what-heading" className="border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 md:py-28">
            <h2 id="what-heading" className="display max-w-3xl text-[36px] sm:text-[48px]">
              What the helpdesk does for you
            </h2>
            <div className="mt-16 space-y-24 md:mt-24 md:space-y-32">
              {FEATURES.map((f, i) => (
                <div key={f.id} className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
                  <div className={i % 2 === 1 ? 'md:order-2' : undefined}>
                    <h3 className="display text-[30px] sm:text-[36px]">{f.title}</h3>
                    <p className="mt-5 max-w-md text-[16px] leading-7 text-ink-secondary">{f.body}</p>
                    <CheckList items={f.points} className="mt-8" />
                    <ArrowLink to={f.link.to} className="mt-10">{f.link.label}</ArrowLink>
                  </div>
                  <PublicImage src={f.image} className="aspect-[9/7] w-full" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Help teaser */}
        <section id="help" aria-labelledby="help-heading" className="scroll-mt-4 border-t border-line bg-surface">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 md:grid-cols-[1fr_1.4fr] md:py-28">
            <div>
              <Eyebrow>Help</Eyebrow>
              <h2 id="help-heading" className="display mt-5 text-[36px] sm:text-[48px]">
                Common questions
              </h2>
              <p className="mt-5 max-w-sm text-[16px] leading-7 text-ink-secondary">
                More answers are in the help articles once you have signed in.
              </p>
              <ArrowLink to={viaSignIn('/portal/help')} className="mt-8">Browse help articles</ArrowLink>
            </div>
            <div className="border-t border-line">
              {FAQS.map((f) => (
                <details key={f.q} className="group border-b border-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[18px] text-ink [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span aria-hidden className="text-[22px] leading-none font-light text-ink-secondary transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="max-w-xl pb-6 text-[15px] leading-7 text-ink-secondary">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-end md:justify-between md:py-28">
            <h2 className="display max-w-2xl text-[36px] sm:text-[56px]">Need a hand with something?</h2>
            <Link to={RAISE} className={buttonClasses({ size: 'lg', className: 'h-12 px-8 text-[14px] tracking-[0.08em] uppercase' })}>
              Raise a request
            </Link>
          </div>
        </section>
      </main>
      <LandingFooter />
    </PublicTheme>
  );
}
