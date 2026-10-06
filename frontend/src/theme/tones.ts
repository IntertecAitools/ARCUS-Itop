/**
 * Semantic tones. Components take a `tone` prop and never a colour.
 * Full class strings are listed here so Tailwind can detect them.
 */
export type Tone =
  | 'priority-critical'
  | 'priority-high'
  | 'priority-medium'
  | 'priority-low'
  | 'status-new'
  | 'status-assigned'
  | 'status-resolved'
  | 'status-closed'
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'purple';

/** Soft pill: tinted background + strong text */
export const toneClasses: Record<Tone, string> = {
  'priority-critical': 'bg-danger-solid text-white',
  'priority-high': 'bg-danger-soft text-danger-strong',
  'priority-medium': 'bg-warning-soft text-warning-strong',
  'priority-low': 'bg-primary-soft text-primary-hover',
  'status-new': 'bg-primary-soft text-primary-hover',
  'status-assigned': 'bg-primary-soft text-primary-hover',
  'status-resolved': 'bg-success-soft text-success-strong',
  'status-closed': 'bg-neutral-soft text-neutral-strong',
  neutral: 'bg-neutral-soft text-neutral-strong',
  info: 'bg-primary-soft text-primary-hover',
  success: 'bg-success-soft text-success-strong',
  warning: 'bg-warning-soft text-warning-strong',
  danger: 'bg-danger-soft text-danger-strong',
  purple: 'bg-purple-soft text-purple',
};

/** Dot / accent colour for each tone (legends, status dots) */
export const toneDotClasses: Record<Tone, string> = {
  'priority-critical': 'bg-danger-solid',
  'priority-high': 'bg-orange',
  'priority-medium': 'bg-yellow',
  'priority-low': 'bg-primary',
  'status-new': 'bg-primary',
  'status-assigned': 'bg-purple',
  'status-resolved': 'bg-success',
  'status-closed': 'bg-text-muted',
  neutral: 'bg-text-muted',
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  purple: 'bg-purple',
};

/** Icon bubble tones used by KPI cards */
export type AccentTone = 'primary' | 'danger' | 'success' | 'warning' | 'purple';

export const accentBubbleClasses: Record<AccentTone, string> = {
  primary: 'bg-primary-soft text-primary',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning-strong',
  purple: 'bg-purple-soft text-purple',
};
