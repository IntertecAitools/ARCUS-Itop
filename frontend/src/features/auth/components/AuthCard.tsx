import type { FormEvent, ReactNode } from 'react';
import { env } from '@/config/env';

/** The centred card every signed-out screen (sign-in, password reset) sits in. */
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
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-sm rounded-panel border border-line bg-surface-raised p-6 shadow-overlay"
        aria-label={label}
      >
        <h1 className="text-[18px] font-semibold text-ink">
          {env.appName} {env.platformName}
        </h1>
        <p className="mt-1 mb-5 text-[13px] text-ink-muted">{intro}</p>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
          >
            {error}
          </div>
        ) : null}

        {children}
      </form>
    </div>
  );
}

/** A confirmation inside an AuthCard, e.g. "check your email". */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-card border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good-ink"
    >
      {children}
    </div>
  );
}
