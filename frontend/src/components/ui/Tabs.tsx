import type { KeyboardEvent } from 'react';
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
  /** The tab list's accessible name, when nothing nearby names it. */
  label?: string;
}

/**
 * The ARIA tabs keyboard pattern for any `role="tablist"`: only the selected
 * tab is in the Tab order (give it `tabIndex={0}`, the others `-1`), and the
 * arrow keys, Home and End move between tabs and select the one they land on.
 * Left/right follow the reading direction, so they swap in right-to-left.
 */
export function onTabListKeyDown(e: KeyboardEvent<HTMLElement>) {
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'));
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
  const next = rtl ? 'ArrowLeft' : 'ArrowRight';
  const prev = rtl ? 'ArrowRight' : 'ArrowLeft';
  let to: number;
  if (e.key === next) to = (at + 1) % tabs.length;
  else if (e.key === prev) to = (at - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = tabs.length - 1;
  else return;
  e.preventDefault();
  tabs[to].focus();
  tabs[to].click();
}

/** Underline tabs — used for in-card view switches (Incidents / Approvals / …). */
export function Tabs({ items, value, onChange, className, label }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onTabListKeyDown}
      className={cn('flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-line', className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap',
              'transition-colors duration-150',
              // The strip scrolls, so an outline drawn outside the tab would be
              // clipped: draw it inside.
              'focus-visible:-outline-offset-2',
              active
                ? 'border-brand text-brand-ink'
                : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink-secondary',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'rounded-pill px-1.5 py-px text-[11px] font-semibold tabular-nums',
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
