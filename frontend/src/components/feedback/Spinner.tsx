import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <Loader2 className={cn('size-4 animate-spin text-ink-muted', className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-panel fallback while a lazily-loaded module chunk arrives. */
export function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="size-6" label="Loading module" />
    </div>
  );
}
