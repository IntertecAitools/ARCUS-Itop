const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 6 Oct 2026 */
export function formatDate(value: string | Date | null | undefined, locale = 'en-GB'): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** 6 Oct 2026, 14:05 */
export function formatDateTime(value: string | Date | null | undefined, locale = 'en-GB'): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Tuesday · 6 October 2026, split for the page header date block */
export function formatHeaderDate(value: Date = new Date(), locale = 'en-GB'): { weekday: string; date: string } {
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(value),
    date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(value),
  };
}

/** Whole days from today to the date (negative = in the past). */
export function daysFromToday(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

export function isToday(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  return daysFromToday(value, now) === 0;
}

/** A due date is overdue when it is before today. */
export function isOverdue(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  const days = daysFromToday(value, now);
  return days !== null && days < 0;
}

/** YYYY-MM-DD for <input type="date"> */
export function toIsoDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
