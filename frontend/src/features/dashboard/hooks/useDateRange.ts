import { useSearchParams } from 'react-router-dom';
import type { DateRange } from '../types';

const RANGES: Array<{ value: DateRange; label: string }> = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
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
