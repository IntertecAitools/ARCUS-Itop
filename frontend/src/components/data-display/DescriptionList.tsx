import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DescriptionItem {
  label: string;
  value: ReactNode;
  /** Span the full width (e.g. descriptions) */
  wide?: boolean;
}

export function DescriptionList({ items, className }: { items: DescriptionItem[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.label} className={cn('min-w-0', item.wide && 'sm:col-span-2')}>
          <dt className="text-xs font-medium text-text-muted">{item.label}</dt>
          <dd className="mt-1 text-sm text-text">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
