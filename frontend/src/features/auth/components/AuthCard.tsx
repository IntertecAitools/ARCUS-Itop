import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/layout';
import { Eyebrow, PublicImage, PublicTheme, PublicThemeToggle } from '@/components/public';
import { publicImagery } from '@/assets/images/public';
import { env } from '@/config/env';

/**
 * The frame every signed-out screen (sign-in, password reset) sits in: the
 * public look, a picture on wide screens, and the form on its own column.
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
    <PublicTheme className="grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden lg:block" aria-hidden>
        <PublicImage src={publicImagery.hero} className="absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-12 pt-32">
          <p className="display max-w-md text-[40px] text-white">Help is one request away.</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label={`${env.appName} ${env.platformName}, home`}>
            <Logo />
          </Link>
          <PublicThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <form onSubmit={onSubmit} noValidate className="w-full max-w-sm" aria-label={label}>
            <Eyebrow>{label}</Eyebrow>
            <h1 className="display mt-4 text-[36px] sm:text-[44px]">
              {env.appName} {env.platformName}
            </h1>
            <p className="mt-3 mb-8 text-[15px] leading-6 text-ink-secondary">{intro}</p>

            {error ? (
              <div
                role="alert"
                className="mb-5 rounded-card border border-critical/40 bg-critical-soft px-3 py-2.5 text-[13px] text-critical-ink"
              >
                {error}
              </div>
            ) : null}

            {children}
          </form>
        </div>

        <Link to="/" className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-secondary hover:text-ink">
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
      className="rounded-card border border-good/40 bg-good-soft px-3 py-2.5 text-[13px] text-good-ink"
    >
      {children}
    </div>
  );
}
