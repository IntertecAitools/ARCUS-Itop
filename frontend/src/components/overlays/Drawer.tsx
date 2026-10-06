'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useDialogBehaviour } from './Modal';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  label: string;
  side?: 'left' | 'right';
  children: ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, label, side = 'left', children, className }: DrawerProps) {
  const panelRef = useDialogBehaviour(open, onClose);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-text/40" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-popover focus:outline-none',
          side === 'left' ? 'left-0' : 'right-0',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
