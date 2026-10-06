import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warning' | 'serious' | 'critical' | 'brand';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-ink',
  info: 'bg-info-soft text-info-ink',
  good: 'bg-good-soft text-good-ink',
  warning: 'bg-warning-soft text-warning-ink',
  serious: 'bg-serious-soft text-serious-ink',
  critical: 'bg-critical-soft text-critical-ink',
  brand: 'bg-brand-soft text-brand-ink',
};

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-neutral',
  info: 'bg-info',
  good: 'bg-good',
  warning: 'bg-warning',
  serious: 'bg-serious',
  critical: 'bg-critical',
  brand: 'bg-brand',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Leading dot — the secondary (non-colour) cue that the tone is meaningful. */
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

/**
 * A status chip. Tone is never the only signal: the label always states the
 * value, and `dot`/`icon` give a second, non-colour channel.
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  icon,
  size = 'md',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn('size-1.5 rounded-full', dotClasses[tone])} aria-hidden /> : null}
      {icon}
      {children}
    </span>
  );
}
