import { useId } from 'react';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';

/**
 * The Intertec mark: a ring opened by a needle rising to a red dot.
 *
 * Drawn rather than imported so it takes the theme's ink (charcoal on light,
 * near-white on dark, `--arcus-logo-ink`) and stays crisp at any size. The
 * dot keeps the brand red in both themes (`--arcus-logo-dot`).
 */
export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: the logo appears more than once on some pages.
  const mask = `intertec-gap-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 400 470" className={className} role="img" aria-hidden focusable="false">
      <defs>
        <mask id={mask}>
          <rect width="400" height="470" fill="#fff" />
          {/* The slit between the two blades, cut through the ring. */}
          <path d="M245 68 L83 514 L157 538 Z" fill="#000" />
        </mask>
      </defs>
      <g style={{ fill: 'var(--arcus-logo-ink, currentColor)' }}>
        {/* Ring: thin at the top, thickening towards the base. */}
        <path
          mask={`url(#${mask})`}
          fillRule="evenodd"
          d="M7 272a184 184 0 1 0 368 0a184 184 0 1 0 -368 0Z M19 264a172 172 0 1 0 344 0a172 172 0 1 0 -344 0Z"
        />
        <path d="M245 68 L78 395 L110 440 Z" />
        <path d="M245 68 L172 460 L218 437 Z" />
      </g>
      <circle cx="265" cy="32" r="31" style={{ fill: 'var(--arcus-logo-dot, #d0453a)' }} />
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
      <LogoMark className="h-10 w-[34px] shrink-0" />

      {!collapsed ? (
        <span className="min-w-0 leading-none">
          <span className="block truncate text-[17px] font-semibold tracking-tight text-ink">
            {env.appName}
          </span>
          {/* Product tagline under the wordmark. */}
          <span className="mt-0.5 block text-[10px] font-medium tracking-[0.14em] text-ink-muted uppercase">
            {env.platformName}
          </span>
        </span>
      ) : null}

      <span className="sr-only">
        {env.appName} {env.platformName}
      </span>
    </div>
  );
}
