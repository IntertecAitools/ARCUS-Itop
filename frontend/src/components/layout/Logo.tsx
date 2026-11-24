import { useId } from 'react';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';
import { useProductName } from '@/features/branding';

/** The installation's built-in mark (BRAND_MARK on the web server): Intertec's, or IRAOPS'. */
export function LogoMark({ className }: { className?: string }) {
  return env.brandMark === 'iraops' ? <IraopsMark className={className} /> : <IntertecMark className={className} />;
}

/**
 * The IRAOPS mark: a hexagon framing a line that climbs to a teal dot.
 *
 * Same footprint and theming as the Intertec mark: the frame and line take
 * the theme's ink (`--arcus-logo-ink`); the dot is IRAOPS teal in both themes.
 */
export function IraopsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 470" className={className} role="img" aria-hidden focusable="false">
      <g style={{ fill: 'var(--arcus-logo-ink, currentColor)' }}>
        {/* Hexagon frame, point up. */}
        <path
          fillRule="evenodd"
          d="M200 45 L377.5 147.5 L377.5 352.5 L200 455 L22.5 352.5 L22.5 147.5 Z M200 83 L344.6 166.5 L344.6 333.5 L200 417 L55.4 333.5 L55.4 166.5 Z"
        />
      </g>
      {/* The climbing line: a dip, then up to the dot. */}
      <path
        d="M98 310 L162 246 L210 294 L292 212"
        style={{ stroke: 'var(--arcus-logo-ink, currentColor)' }}
        fill="none"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="300" cy="204" r="34" style={{ fill: '#13a58c' }} />
    </svg>
  );
}

/**
 * The Intertec mark: a ring opened by a needle rising to a red dot.
 *
 * Drawn rather than imported so it takes the theme's ink (charcoal on light,
 * near-white on dark, `--arcus-logo-ink`) and stays crisp at any size. The
 * dot keeps the brand red in both themes (`--arcus-logo-dot`).
 */
export function IntertecMark({ className }: { className?: string }) {
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
 * Brand lockup: the Intertec wordmark over the platform it runs on, or a
 * tenant's own logo and product name (features/branding) on their site.
 *
 * The default name comes from `VITE_APP_NAME`; a tenant's from its branding.
 * Never a component edit for a re-brand.
 */
export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const name = useProductName();
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {name.logo ? (
        <img src={name.logo} alt="" className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <LogoMark className="h-10 w-[34px] shrink-0" />
      )}

      {!collapsed ? (
        <span className="min-w-0 leading-none" aria-hidden>
          <span className="block truncate text-[17px] font-semibold tracking-tight text-ink">{name.wordmark}</span>
          {/* Product tagline under the wordmark. The space keeps the two words
              apart in the text a link around the logo is named by (WCAG 2.5.3,
              label in name: "Intertec Servicedesk", not "IntertecServicedesk"). */}
          {name.tagline ? ' ' : null}
          {name.tagline ? (
            <span className="mt-0.5 block text-[10px] font-medium tracking-[0.14em] text-ink-muted uppercase">
              {name.tagline}
            </span>
          ) : null}
        </span>
      ) : null}

      <span className="sr-only">{name.full}</span>
    </div>
  );
}
