'use client';

import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore, type ToastMessage, type ToastTone } from '@/stores';

const icons: Record<ToastTone, typeof Info> = {
  success: CircleCheck,
  danger: CircleAlert,
  info: Info,
  warning: TriangleAlert,
};

const iconTone: Record<ToastTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  info: 'text-primary',
  warning: 'text-warning-strong',
};

function ToastItem({ toast, dismissLabel }: { toast: ToastMessage; dismissLabel: string }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const Icon = icons[toast.tone];

  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), toast.tone === 'danger' ? 8000 : 4500);
    return () => clearTimeout(id);
  }, [dismiss, toast.id, toast.tone]);

  return (
    <div
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-popover"
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', iconTone[toast.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-text-muted">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="rounded-chip p-0.5 text-text-muted hover:text-text"
        aria-label={dismissLabel}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function Toaster({ dismissLabel = 'Dismiss' }: { dismissLabel?: string }) {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismissLabel={dismissLabel} />
      ))}
    </div>
  );
}
