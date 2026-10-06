/**
 * Chart palette + shared chart chrome.
 *
 * ── Why the order matters ──────────────────────────────────────────────────
 * The eight categorical slots are assigned in a FIXED order and are never
 * cycled. The ordering itself is the colour-blind-safety mechanism: candidate
 * orderings were enumerated and only one clearing every adjacent-pair gate in
 * BOTH light and dark was kept.
 *
 * Validated with the dataviz palette validator against the real card surfaces
 * (light #ffffff, dark #111827) — all six checks PASS in both modes:
 *
 *   light  lightness band ✓  chroma ✓  CVD ΔE 12.5 ✓  normal-vision ΔE 22.8 ✓  contrast ✓
 *   dark   lightness band ✓  chroma ✓  CVD ΔE 12.5 ✓  normal-vision ΔE 21.5 ✓  contrast ✓
 *
 * If you re-order, re-step or add a hue, RE-RUN the validator. A ninth series
 * is never a generated hue — fold the tail into "Other", or use small multiples.
 */

export const SERIES_LIMIT = 8;

/** Categorical slots, in assignment order. Index 0 is always the first series. */
export const seriesPalette = [
  'var(--arcus-series-1)', // blue
  'var(--arcus-series-2)', // orange
  'var(--arcus-series-3)', // teal
  'var(--arcus-series-4)', // amber
  'var(--arcus-series-5)', // violet
  'var(--arcus-series-6)', // green
  'var(--arcus-series-7)', // sky
  'var(--arcus-series-8)', // red
] as const;

/**
 * Colour follows the ENTITY, never its rank — so a filter that changes the
 * series count must not repaint the survivors. Pass a stable key list (the full
 * universe of entities, in a fixed order) and look each entity up by name.
 */
export function createSeriesScale(keys: readonly string[]) {
  const assigned = new Map<string, string>();
  keys.forEach((key, i) => {
    if (i < SERIES_LIMIT) assigned.set(key, seriesPalette[i]);
  });
  return (key: string) => assigned.get(key) ?? 'var(--arcus-ink-muted)';
}

/** Single-hue ramp for magnitude (heatmaps, choropleths, intensity cells). */
export const sequentialRamp = [
  'var(--arcus-seq-100)',
  'var(--arcus-seq-200)',
  'var(--arcus-seq-300)',
  'var(--arcus-seq-400)',
  'var(--arcus-seq-500)',
  'var(--arcus-seq-600)',
  'var(--arcus-seq-700)',
] as const;

/** Recessive chrome: the data should be the loudest thing in the frame. */
export const chartChrome = {
  grid: 'var(--arcus-grid)',
  axis: 'var(--arcus-line-strong)',
  tick: 'var(--arcus-ink-muted)',
  surface: 'var(--arcus-surface)',
  label: 'var(--arcus-ink-secondary)',
  /** 2px gap between adjacent fills so segments read as separate marks. */
  segmentGap: 2,
} as const;

export const axisTickStyle = {
  fill: chartChrome.tick,
  fontSize: 11,
} as const;
