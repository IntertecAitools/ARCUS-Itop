import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
  className?: string;
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, tone = 'neutral', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary',
        )}
        aria-hidden
      >
        <Icon className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold text-text">{title}</p>
        {description && <p className="max-w-md text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
