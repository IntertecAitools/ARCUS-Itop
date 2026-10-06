'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface MenuProps {
  /** Renders the trigger; spread `props` onto a <button>. */
  trigger: (props: {
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
    onClick: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  }) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  className?: string;
}

/** Popup menu with outside-click close and arrow-key navigation. */
export function Menu({ trigger, items, align = 'right', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current.find((el) => el && !el.disabled)?.focus();
  }, [open]);

  function focusItem(delta: number) {
    const enabled = itemRefs.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled);
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    enabled[(index + delta + enabled.length) % enabled.length]?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(-1);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      {trigger({
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': menuId,
        onClick: () => setOpen((v) => !v),
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        },
      })}
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute z-40 mt-2 min-w-48 rounded-control border border-border bg-surface p-1 shadow-popover',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex w-full items-center gap-2 rounded-chip px-3 py-2 text-left text-sm text-text hover:bg-surface-muted focus:bg-primary-soft focus:outline-none disabled:text-text-muted"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Non-menu popover (e.g. column chooser) with outside-click close. */
export function Popover({
  trigger,
  children,
  align = 'right',
  label,
}: {
  trigger: (props: { 'aria-expanded': boolean; onClick: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {trigger({ 'aria-expanded': open, onClick: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            'absolute z-40 mt-2 min-w-56 rounded-control border border-border bg-surface p-3 shadow-popover',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
