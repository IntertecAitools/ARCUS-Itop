import { cn } from '@/lib/utils';

/** IRAOPS logo: blue stacked-layers icon + bold wordmark. */
export function Logo({ showWordmark = true, className }: { showWordmark?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M16 7 6 12l10 5 10-5-10-5Z" className="fill-white" />
        <path d="m6 16 10 5 10-5" className="stroke-white" strokeWidth="2" strokeLinejoin="round" fill="none" />
        <path d="m6 20 10 5 10-5" className="stroke-white/70" strokeWidth="2" strokeLinejoin="round" fill="none" />
      </svg>
      {showWordmark && <span className="text-xl font-extrabold tracking-tight text-text">IRAOPS</span>}
    </span>
  );
}
