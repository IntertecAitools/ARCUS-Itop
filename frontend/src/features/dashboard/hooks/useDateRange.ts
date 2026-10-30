import { useSearchParams } from 'react-router-dom';
import type { DateRange } from '../types';

/** `label` is a translation key. */
const RANGES: Array<{ value: DateRange; label: string }> = [
  { value: '24h', label: 'dashboard.ranges.24h' },
  { value: '7d', label: 'dashboard.ranges.7d' },
  { value: '30d', label: 'dashboard.ranges.30d' },
  { value: '90d', label: 'dashboard.ranges.90d' },
];

const isRange = (value: string | null): value is DateRange =>
  RANGES.some((r) => r.value === value);

/**
 * The dashboard's time window, kept in the URL so a filtered view is
 * shareable and survives a reload or a back button.
 */
export function useDateRange() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('range');
  const range: DateRange = isRange(raw) ? raw : '7d';

  const setRange = (next: DateRange) => {
    const updated = new URLSearchParams(params);
    updated.set('range', next);
    setParams(updated, { replace: true });
  };

  return { range, setRange, options: RANGES };
}
