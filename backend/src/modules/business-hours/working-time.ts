import { addDays, itopDay, itopTimeToIso, weekday } from "../../shared/itop-time.js";
import { WEEKDAYS, type OpenInterval } from "./business-hours.types.js";

/**
 * Working-time arithmetic, the way Combodo's SLA computation counts it: only
 * the coverage window's open hours count, in iTop's time zone, and no hour
 * of a holiday does. Kept free of I/O so it can be tested on plain values.
 */

/** "HH:MM" to minutes since midnight; "24:00" is 1440. */
export function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Reasons a set of intervals cannot be saved; empty when it can. */
export function intervalProblems(intervals: OpenInterval[]): string[] {
  const problems: string[] = [];
  for (const day of WEEKDAYS) {
    const spans = intervals
      .filter((i) => i.weekday === day)
      .map((i) => ({ i, from: minutesOf(i.start), to: minutesOf(i.end) }))
      .sort((a, b) => a.from - b.from);
    for (const s of spans) {
      if (!(s.from < s.to)) problems.push(`${day} ${s.i.start}–${s.i.end}: the end must be after the start.`);
    }
    for (let k = 1; k < spans.length; k += 1) {
      if (spans[k]!.from < spans[k - 1]!.to) {
        problems.push(`${day}: ${spans[k - 1]!.i.start}–${spans[k - 1]!.i.end} overlaps ${spans[k]!.i.start}–${spans[k]!.i.end}.`);
      }
    }
  }
  return problems;
}

/** Each weekday's index in JavaScript's getUTCDay (0 = Sunday). */
const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** The most days one count walks: a deadline beyond a year out is not "at risk". */
const MAX_DAYS = 400;

/** An instant at a wall-clock minute of a day in `timeZone`. */
function at(day: string, minutes: number, timeZone: string): number {
  if (minutes >= 1440) return at(addDays(day, 1), minutes - 1440, timeZone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return Date.parse(itopTimeToIso(`${day} ${hh}:${mm}:00`, timeZone));
}

/**
 * Seconds of open time between two instants: the overlap of [fromMs, toMs]
 * with the window's intervals, holidays (YYYY-MM-DD) left out. Negative
 * when `toMs` is before `fromMs`.
 */
export function workingSeconds(
  fromMs: number,
  toMs: number,
  intervals: OpenInterval[],
  holidays: ReadonlySet<string>,
  timeZone: string,
): number {
  if (toMs < fromMs) return -workingSeconds(toMs, fromMs, intervals, holidays, timeZone);
  const byDay = new Map<number, Array<[number, number]>>();
  for (const i of intervals) {
    const index = DAY_INDEX[i.weekday];
    if (index === undefined) continue;
    const list = byDay.get(index) ?? [];
    list.push([minutesOf(i.start), minutesOf(i.end)]);
    byDay.set(index, list);
  }

  let total = 0;
  let day = itopDay(new Date(fromMs), timeZone);
  const last = itopDay(new Date(toMs), timeZone);
  for (let n = 0; n <= MAX_DAYS; n += 1) {
    if (!holidays.has(day)) {
      for (const [from, to] of byDay.get(weekday(day)) ?? []) {
        const start = Math.max(at(day, from, timeZone), fromMs);
        const end = Math.min(at(day, to, timeZone), toMs);
        if (end > start) total += end - start;
      }
    }
    if (day === last) break;
    day = addDays(day, 1);
  }
  return total / 1000;
}
