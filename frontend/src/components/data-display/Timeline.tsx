import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { toneClasses, type Tone } from '@/theme';

export interface TimelineItem {
  id: string;
  date: string;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
}

export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol aria-label={label} className="relative space-y-5">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <li key={item.id} className="relative flex gap-3">
            {index < items.length - 1 && (
              <span className="absolute top-9 bottom-[-20px] left-4 w-px bg-border" aria-hidden />
            )}
            <span
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', toneClasses[item.tone ?? 'info'])}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-text">{item.title}</p>
                <time dateTime={item.date} className="text-xs text-text-muted">
                  {formatDateTime(item.date)}
                </time>
              </div>
              {item.description && <div className="mt-1 text-sm text-text-muted">{item.description}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
