import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';

/** Compact counts for KPI tiles: 1_240 → "1.2K". */
export function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function percent(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat(undefined, {
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
  if (isToday(date)) return `Today ${format(date, 'HH:mm')}`;
  if (isYesterday(date)) return `Yesterday ${format(date, 'HH:mm')}`;
  return shortDateTime(date);
}

export function relativeTime(value: string | Date) {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
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
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
