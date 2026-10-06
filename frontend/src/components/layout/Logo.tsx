import { cn } from '@/lib/utils';
import { env } from '@/config/env';

/**
 * Brand lockup. The wordmark comes from `VITE_APP_NAME`, and the mark is drawn
 * from tokens — so re-branding is an env var plus the brand tokens, never a
 * component edit.
 */
export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const mark = env.appName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .slice(0, 2);

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-[13px] font-bold text-white shadow-xs"
      >
        {mark}
      </span>
      {!collapsed ? (
        <span className="truncate text-[17px] font-semibold tracking-tight text-ink">
          {env.appName}
        </span>
      ) : null}
      <span className="sr-only">{env.appName}</span>
    </div>
  );
}
