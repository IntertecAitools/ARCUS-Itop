import { format as formatDate, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import { dateLocale, i18n, intlLocale } from '@/lib/i18n';

/**
 * Every date and number here follows the interface language (lib/i18n):
 * Arabic month names and digits in Arabic, English otherwise. Patterns stay
 * the same, so a layout does not shift between languages.
 */
const format = (date: Date, pattern: string) => formatDate(date, pattern, { locale: dateLocale() });

/** Compact counts for KPI tiles: 1_240 → "1.2K". */
export function compactNumber(value: number) {
  return new Intl.NumberFormat(intlLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function percent(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Table timestamps: "05 Oct 10:42" — short, sortable-looking, unambiguous. */
export function shortDateTime(value: string | Date) {
  return format(new Date(value), 'dd MMM HH:mm');
}

export function longDate(value: string | Date) {
  return format(new Date(value), 'EEE, dd MMM yyyy');
}

/** "Today 10:42" / "Yesterday 09:15" / "03 Oct 16:21" */
export function friendlyDateTime(value: string | Date) {
  const date = new Date(value);
  if (isToday(date)) return i18n.t('common.today', { time: format(date, 'HH:mm') });
  if (isYesterday(date)) return i18n.t('common.yesterday', { time: format(date, 'HH:mm') });
  return shortDateTime(date);
}

export function relativeTime(value: string | Date) {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true, locale: dateLocale() });
}

/**
 * An exact instant ("2026-10-20T12:04:17.000Z", or with an offset), which is
 * how the BFF sends every iTop DateTime. Date-only values (YYYY-MM-DD) are
 * not instants: they name a calendar day and are shown as they are.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && INSTANT.test(value);
}

/** A record's date-time in the viewer's zone: "20 Oct 2026, 17:34". Anything else as given. */
export function dateTimeText(value: string) {
  return isInstant(value) ? format(new Date(value), 'dd MMM yyyy, HH:mm') : value;
}

/** An instant as an <input type="datetime-local"> value, in the viewer's zone. */
export function toDateTimeInput(value: string) {
  // A machine value for the input, never localised.
  return isInstant(value) ? formatDate(new Date(value), "yyyy-MM-dd'T'HH:mm") : value;
}

/** A datetime-local input's value (the viewer's wall clock) as an exact instant; "" stays "". */
export function fromDateTimeInput(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** "AB" from "Ada Byron" — avatar fallbacks. */
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Pick the greeting for the dashboard hero line. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return i18n.t('common.goodMorning');
  if (hour < 18) return i18n.t('common.goodAfternoon');
  return i18n.t('common.goodEvening');
}

/** A whole number in the interface language: "1,240" or "١٬٢٤٠". */
export function numberText(value: number) {
  return new Intl.NumberFormat(intlLocale()).format(value);
}
