import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-control bg-surface-hover', className)}
    />
  );
}

/** Placeholder with the same silhouette as a loaded card, to avoid layout shift. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-card border border-line bg-surface p-5 shadow-card', className)}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-24" />
      <Skeleton className="mt-4 h-24 w-full" />
    </div>
  );
}
