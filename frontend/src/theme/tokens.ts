/**
 * Token names as TypeScript values.
 *
 * `globals.css` owns the raw hex. This module only names the CSS variables, so
 * code that must pass a colour to a library (Recharts, canvas, an <svg fill>)
 * stays theme-aware: the value resolves at paint time and follows the active
 * light/dark set automatically.
 *
 * Rule: never put a hex literal in a component. Import from here.
 */

/** Wrap a token name as a CSS `var()` reference. */
const v = (name: string) => `var(--arcus-${name})`;

export const surface = {
  canvas: v('canvas'),
  base: v('surface'),
  raised: v('surface-raised'),
  sunken: v('surface-sunken'),
  hover: v('surface-hover'),
} as const;

export const ink = {
  primary: v('ink'),
  secondary: v('ink-secondary'),
  muted: v('ink-muted'),
  inverse: v('ink-inverse'),
} as const;

export const line = {
  base: v('line'),
  strong: v('line-strong'),
  grid: v('grid'),
} as const;

export const brand = {
  base: v('brand'),
  hover: v('brand-hover'),
  active: v('brand-active'),
  soft: v('brand-soft'),
  ink: v('brand-ink'),
  ring: v('ring'),
} as const;

/**
 * Status roles are RESERVED. They are never used as a chart series colour, and
 * never carry meaning on their own — every status mark ships with an icon and a
 * text label beside it.
 */
export const status = {
  good: v('good'),
  warning: v('warning'),
  serious: v('serious'),
  critical: v('critical'),
  neutral: v('neutral'),
  info: v('info'),
} as const;

export type StatusRole = keyof typeof status;

export const radius = {
  control: '0.625rem',
  card: '0.875rem',
  panel: '1rem',
  pill: '9999px',
} as const;

export const layout = {
  sidebarWidth: 240,
  sidebarCollapsedWidth: 72,
  topbarHeight: 56,
} as const;
