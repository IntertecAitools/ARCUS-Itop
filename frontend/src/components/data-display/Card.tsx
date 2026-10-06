import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CardProps {
  title?: string;
  /** Right side of the header: a "⋯" Menu, a range Select … */
  actions?: ReactNode;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div';
}

export function Card({
  title,
  actions,
  viewAllHref,
  viewAllLabel = 'View all',
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
}: CardProps) {
  const hasHeader = title || actions || viewAllHref;
  return (
    <Tag
      className={cn('flex flex-col rounded-card border border-border bg-surface shadow-card', className)}
      aria-label={Tag === 'section' ? title : undefined}
    >
      {hasHeader && (
        <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          {title && <h2 className="min-w-0 text-base font-semibold text-text">{title}</h2>}
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-link hover:underline"
              >
                {viewAllLabel}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
          </div>
        </header>
      )}
      <div className={cn('flex-1 px-5 pb-5', !hasHeader && 'pt-5', bodyClassName)}>{children}</div>
    </Tag>
  );
}
