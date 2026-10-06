import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  /** Optional count shown as a pill after the label. */
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Underline tabs — used for in-card view switches (Incidents / Approvals / …). */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-line', className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium',
              'transition-colors duration-150',
              active
                ? 'border-brand text-brand-ink'
                : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink-secondary',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums',
                  active ? 'bg-brand-soft text-brand-ink' : 'bg-neutral-soft text-neutral-ink',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
