import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 text-sm text-text-muted', className)}>
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Full-screen spinner shown while the app boots (MSW start, session hydration). */
export function BootSplash({ label = 'Loading' }: { label?: string }) {
  return <Spinner label={label} className="min-h-screen" />;
}
