import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Right-hand controls: date range, filters, primary action. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Every routed screen opens with this, so page titles, breadcrumbs and the
 * action row sit in exactly the same place across modules.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-ink-secondary">{description}</p>
          ) : null}
        </div>

        {/* Filters live in ONE row above the content — never scattered per card. */}
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
