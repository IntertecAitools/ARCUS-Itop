import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const textareaClass =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

export const selectClass =
  'h-9 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-ring/40';

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-critical-ink">
      {error instanceof Error ? error.message : 'That did not work.'}
    </p>
  );
}

/** A labelled control, the label above it. */
export function Labelled({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-ink-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A one-paragraph notice in the panel: what happened to this ticket. */
export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'warning';
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-card border px-3 py-2.5 text-[13px]',
        tone === 'warning' ? 'border-warning/30 bg-warning-soft' : 'border-line bg-surface-sunken',
      )}
    >
      <p className="mb-0.5 text-[11.5px] font-semibold tracking-wide text-ink-secondary uppercase">{title}</p>
      <div className="text-ink">{children}</div>
    </div>
  );
}
