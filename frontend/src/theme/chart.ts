/**
 * Chart colours as CSS variable references, so charts follow the tokens in tokens.css.
 */
export const chartColor = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger-solid)',
  orange: 'var(--color-orange)',
  yellow: 'var(--color-yellow)',
  purple: 'var(--color-purple)',
  muted: 'var(--color-text-muted)',
  grid: 'var(--color-border)',
  surface: 'var(--color-surface)',
} as const;

export type ChartColor = keyof typeof chartColor;
