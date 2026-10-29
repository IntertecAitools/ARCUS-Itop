import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/layout';
import { Chip, PublicTheme, PublicThemeToggle } from '@/components/public';
import { env } from '@/config/env';

/**
 * The frame every signed-out screen (sign-in, password reset) sits in: the
 * public look, the violet horizon on wide screens, and the form in a glass card.
 */
export function AuthCard({
  label,
  intro,
  error,
  onSubmit,
  children,
}: {
  label: string;
  intro: string;
  error?: string | null;
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <PublicTheme className="relative grid overflow-hidden lg:grid-cols-[1.05fr_1fr]">
      {/* Wide screens: the horizon glow and a glimpse of the desk beside the form. */}
      <aside className="relative hidden overflow-hidden border-e border-line lg:block" aria-hidden>
        <div className="hero-arc" style={{ ['--arc-size' as string]: '1500px', ['--arc-top' as string]: '78vh' }} />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Chip className="self-start">{env.platformName}</Chip>
          <div className="reveal is-in max-w-md">
            <p className="display text-[44px] text-ink">Help is one request away.</p>
            <p className="mt-4 text-[16px] leading-7 text-ink-secondary">
              Raise it, follow it and get it fixed, with every update in one place.
            </p>
            <div className="float mt-10 grid grid-cols-2 gap-3">
              {[
                ['98%', 'Responded to on time'],
                ['2.4h', 'Typical time to fix'],
              ].map(([v, l]) => (
                <div key={l} className="glass rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur">
                  <p className="text-[24px] font-semibold tracking-tight text-ink">{v}</p>
                  <p className="mt-1 text-[12px] text-ink-muted">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div className="relative flex min-h-screen flex-col px-5 py-6 sm:px-10">
        {/* Narrow screens: a softer glow behind the form instead of the side panel. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-80 bg-[radial-gradient(50%_50%_at_50%_50%,rgb(var(--arcus-violet)/0.35),transparent)] lg:hidden"
        />
        <div className="relative flex items-center justify-between">
          <Link to="/" aria-label={`${env.appName} ${env.platformName}, home`}>
            <Logo />
          </Link>
          <PublicThemeToggle />
        </div>

        <div className="relative flex flex-1 items-center justify-center py-12">
          <form
            onSubmit={onSubmit}
            noValidate
            className="glass reveal is-in w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-overlay sm:p-9"
            aria-label={label}
          >
            <Chip>{label}</Chip>
            <h1 className="display mt-5 text-[32px] text-ink sm:text-[38px]">
              {env.appName} {env.platformName}
            </h1>
            <p className="mt-3 mb-8 text-[15px] leading-6 text-ink-secondary">{intro}</p>

            {error ? (
              <div
                role="alert"
                className="mb-5 rounded-control border border-critical/40 bg-critical-soft px-3 py-2.5 text-[13px] text-critical-ink"
              >
                {error}
              </div>
            ) : null}

            {children}
          </form>
        </div>

        <Link to="/" className="relative inline-flex items-center gap-1.5 self-start text-[13px] text-ink-secondary hover:text-ink">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          Back to the home page
        </Link>
      </div>
    </PublicTheme>
  );
}

/** A confirmation inside an AuthCard, e.g. "check your email". */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-control border border-good/40 bg-good-soft px-3 py-2.5 text-[13px] text-good-ink"
    >
      {children}
    </div>
  );
}
