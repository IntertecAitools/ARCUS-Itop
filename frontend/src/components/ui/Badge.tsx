import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, toneDotClasses, type Tone } from '@/theme';

export interface BadgeProps {
  tone?: Tone;
  /** Show a leading status dot */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/** Pill with soft background and strong text, 6px radius. */
export function Badge({ tone = 'neutral', dot = false, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', toneDotClasses[tone])} aria-hidden />}
      {children}
    </span>
  );
}
