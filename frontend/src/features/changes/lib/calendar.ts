import type { BadgeTone } from '@/components/ui';
import type { CalendarChange, ChangeStatus, ChangeType } from '../types';

/** The three ways the change calendar is laid out. */
export type CalendarView = 'month' | 'week' | 'day';

/** A change with no planned end is drawn as lasting an hour (as the BFF counts it). */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** Local midnight of the day `date` falls on. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Weeks start on Monday. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/**
 * The days a view shows around `anchor`: a month as whole weeks (Monday of
 * the week of the 1st to Sunday of the week of the last day), a week, or a day.
 */
export function viewDays(view: CalendarView, anchor: Date): Date[] {
  if (view === 'day') return [startOfDay(anchor)];
  if (view === 'week') {
    const monday = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const from = startOfWeek(first);
  const to = addDays(startOfWeek(last), 7);
  const days: Date[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The instants the BFF is asked for: from the first day's midnight to the day after the last. */
export function viewWindow(view: CalendarView, anchor: Date): { from: string; to: string } {
  const days = viewDays(view, anchor);
  return { from: days[0]!.toISOString(), to: addDays(days[days.length - 1]!, 1).toISOString() };
}

/** The anchor one view-length earlier (-1) or later (+1). */
export function shift(view: CalendarView, anchor: Date, step: -1 | 1): Date {
  if (view === 'day') return addDays(anchor, step);
  if (view === 'week') return addDays(anchor, 7 * step);
  return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
}

export function viewTitle(view: CalendarView, anchor: Date): string {
  if (view === 'month') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (view === 'day') {
    return anchor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const days = viewDays('week', anchor);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(days[0]!)} – ${fmt(days[6]!)} ${days[6]!.getFullYear()}`;
}

export function changeSpan(change: Pick<CalendarChange, 'start' | 'end'>): [number, number] {
  const from = Date.parse(change.start);
  const to = change.end ? Date.parse(change.end) : NaN;
  return [from, Number.isFinite(to) && to > from ? to : from + DEFAULT_DURATION_MS];
}

/** The changes running at some point on `day` (local time), earliest first. */
export function changesOn<T extends Pick<CalendarChange, 'start' | 'end'>>(items: T[], day: Date): T[] {
  const from = startOfDay(day).getTime();
  const to = addDays(day, 1).getTime();
  return items
    .filter((c) => c.start)
    .filter((c) => {
      const [s, e] = changeSpan(c);
      return s < to && e > from;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Blackout windows that cover any part of `day`. */
export function windowsOn<T extends { start: string; end: string }>(windows: T[], day: Date): T[] {
  const from = startOfDay(day).getTime();
  const to = addDays(day, 1).getTime();
  return windows.filter((w) => Date.parse(w.start) < to && Date.parse(w.end) > from);
}

export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

/** "YYYY-MM-DD" of a local date, for the URL. */
export function dayParam(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function parseDayParam(text: string | null): Date | null {
  const m = text ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Each change type's colour on the calendar. */
export const TYPE_TONE: Record<ChangeType, BadgeTone> = {
  routine: 'info',
  normal: 'brand',
  emergency: 'serious',
};

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  new: 'New',
  validated: 'Validated',
  rejected: 'Rejected',
  assigned: 'Assigned',
  planned: 'Planned',
  approved: 'Approved',
  not_approved: 'Not approved',
  implemented: 'Implemented',
  monitored: 'Monitored',
  closed: 'Closed',
};

/** How a status changes a change's chip: still to come, done, or not happening. */
export function statusLook(status: ChangeStatus): 'upcoming' | 'done' | 'cancelled' {
  if (status === 'rejected' || status === 'not_approved') return 'cancelled';
  if (status === 'implemented' || status === 'monitored' || status === 'closed') return 'done';
  return 'upcoming';
}
