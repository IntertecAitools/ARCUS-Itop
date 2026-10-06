import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-chip bg-neutral-soft', className)} aria-hidden />;
}
