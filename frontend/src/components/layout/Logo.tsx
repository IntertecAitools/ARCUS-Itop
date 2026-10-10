import { cn } from '@/lib/utils';
import { env } from '@/config/env';

/**
 * The Intertec mark.
 *
 * Two interlocking brackets around a core — a system being held together,
 * which is what a service desk does. Drawn rather than imported so it inherits
 * `currentColor` and stays crisp at any size; a raster asset would need a
 * second file per theme and would blur on a high-DPI rail.
 */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-hidden focusable="false">
      <defs>
        <linearGradient id="arcus-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--arcus-brand)" />
          <stop offset="100%" stopColor="var(--arcus-brand-active)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#arcus-mark)" />
      {/* Left bracket */}
      <path
        d="M13 8.5 A8.5 8.5 0 0 0 13 23.5"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.95"
      />
      {/* Right bracket, mirrored */}
      <path
        d="M19 8.5 A8.5 8.5 0 0 1 19 23.5"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* The core being held */}
      <circle cx="16" cy="16" r="3.1" fill="white" />
    </svg>
  );
}

/**
 * Brand lockup: the Intertec wordmark over the platform it runs on.
 *
 * The product name comes from `VITE_APP_NAME`, so a re-brand is an env var
 * plus the brand tokens — never a component edit.
 */
export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Mark className="size-9 shrink-0 drop-shadow-xs" />

      {!collapsed ? (
        <span className="min-w-0 leading-none">
          <span className="block truncate text-[17px] font-semibold tracking-tight text-ink">
            {env.appName}
          </span>
          {/* The system of record, named quietly underneath. */}
          <span className="mt-0.5 block text-[10px] font-medium tracking-[0.14em] text-ink-muted uppercase">
            {env.platformName}
          </span>
        </span>
      ) : null}

      <span className="sr-only">
        {env.appName} on {env.platformName}
      </span>
    </div>
  );
}
