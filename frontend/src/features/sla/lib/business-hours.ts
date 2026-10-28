import { WEEKDAYS, type OpenInterval, type Weekday } from '../business-hours.types';

export const DAY_SHORT: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

export const DAY_LABEL: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const minutes = (time: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
};

/** The same checks the BFF makes, so the form says what is wrong before saving. */
export function intervalProblems(intervals: OpenInterval[]): string[] {
  const problems: string[] = [];
  for (const day of WEEKDAYS) {
    const spans = intervals
      .filter((i) => i.weekday === day)
      .map((i) => ({ i, from: minutes(i.start), to: minutes(i.end) }))
      .sort((a, b) => a.from - b.from);
    for (const s of spans) {
      if (Number.isNaN(s.from) || Number.isNaN(s.to)) problems.push(`${DAY_LABEL[day]}: use HH:MM.`);
      else if (!(s.from < s.to)) problems.push(`${DAY_LABEL[day]} ${s.i.start}–${s.i.end}: the end must be after the start.`);
    }
    for (let k = 1; k < spans.length; k += 1) {
      if (spans[k]!.from < spans[k - 1]!.to) problems.push(`${DAY_LABEL[day]}: two periods overlap.`);
    }
  }
  return problems;
}

/** "Mon–Fri 09:00–17:00 · Sat 09:00–12:00": consecutive days with the same hours folded together. */
export function summarise(intervals: OpenInterval[]): string {
  if (intervals.length === 0) return 'No open hours';
  const hoursOf = (day: Weekday) =>
    intervals
      .filter((i) => i.weekday === day)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((i) => `${i.start}–${i.end}`)
      .join(', ');
  const parts: string[] = [];
  let k = 0;
  while (k < WEEKDAYS.length) {
    const hours = hoursOf(WEEKDAYS[k]!);
    let j = k;
    while (j + 1 < WEEKDAYS.length && hoursOf(WEEKDAYS[j + 1]!) === hours) j += 1;
    if (hours) {
      const days = j > k ? `${DAY_SHORT[WEEKDAYS[k]!]}–${DAY_SHORT[WEEKDAYS[j]!]}` : DAY_SHORT[WEEKDAYS[k]!];
      parts.push(hours === '00:00–24:00' && j - k === 6 ? '24x7' : `${days} ${hours}`);
    }
    k = j + 1;
  }
  return parts.join(' · ');
}

export const PRESETS: Array<{ label: string; intervals: OpenInterval[] }> = [
  {
    label: 'Office hours (Mon–Fri 09:00–17:00)',
    intervals: WEEKDAYS.slice(0, 5).map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
  },
  {
    label: 'Extended (Mon–Fri 08:00–20:00, Sat 09:00–13:00)',
    intervals: [
      ...WEEKDAYS.slice(0, 5).map((weekday) => ({ weekday, start: '08:00', end: '20:00' })),
      { weekday: 'saturday' as const, start: '09:00', end: '13:00' },
    ],
  },
  {
    label: 'Around the clock (24x7)',
    intervals: WEEKDAYS.map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  },
];
