import { describe, expect, it } from 'vitest';
import { dateTimeText, fromDateTimeInput, isInstant, toDateTimeInput } from './format';

/**
 * The BFF sends every iTop DateTime as an exact instant; these render it on
 * the viewer's own clock, whatever zone the test machine runs in.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const local = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe('date-time formatting', () => {
  it('knows an instant from a date-only or wall-clock value', () => {
    expect(isInstant('2026-10-20T12:04:17.000Z')).toBe(true);
    expect(isInstant('2026-10-20T17:34:17+05:30')).toBe(true);
    expect(isInstant('2026-10-20')).toBe(false);
    expect(isInstant('2026-10-20 14:04:17')).toBe(false);
  });

  it('shows an instant on the local clock and leaves other text alone', () => {
    const iso = '2026-10-20T12:04:17.000Z';
    const d = new Date(iso);
    expect(dateTimeText(iso)).toContain(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    expect(dateTimeText('2026-10-21')).toBe('2026-10-21');
  });

  it('round-trips a datetime-local input through the exact instant', () => {
    const iso = '2026-10-20T12:04:00.000Z';
    expect(toDateTimeInput(iso)).toBe(local(iso));
    expect(fromDateTimeInput(toDateTimeInput(iso))).toBe(iso);
    expect(fromDateTimeInput('')).toBe('');
    expect(toDateTimeInput('')).toBe('');
  });
});
