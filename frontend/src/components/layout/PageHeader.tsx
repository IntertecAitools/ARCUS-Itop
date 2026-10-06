'use client';

import type { ReactNode } from 'react';
import { formatHeaderDate } from '@/lib/utils';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Right-aligned weekday + date block */
  showDate?: boolean;
  actions?: ReactNode;
  /** Small content above the title (e.g. a back link) */
  breadcrumb?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, showDate = false, actions, breadcrumb }: PageHeaderProps) {
  const { weekday, date } = formatHeaderDate();
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {breadcrumb}
        {eyebrow && <p className="text-sm text-text-muted">{eyebrow}</p>}
        <h1 className="text-[32px] leading-10 font-bold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-6">
        {showDate && (
          <p className="hidden text-right sm:block">
            <span className="block text-sm font-semibold text-text">{weekday}</span>
            <span className="block text-sm text-text-muted">{date}</span>
          </p>
        )}
        {actions}
      </div>
    </div>
  );
}
