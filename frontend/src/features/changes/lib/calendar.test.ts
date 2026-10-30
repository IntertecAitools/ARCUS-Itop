import { describe, expect, it } from 'vitest';
import { changesOn, dayParam, parseDayParam, shift, statusLook, viewDays, viewWindow, windowsOn } from './calendar';

const d = (y: number, m: number, day: number, h = 0) => new Date(y, m - 1, day, h);

describe('calendar views', () => {
  it('shows a month as whole weeks, Monday first', () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const days = viewDays('month', d(2026, 11, 15));
    expect(days[0]).toEqual(d(2026, 10, 26));
    expect(days[days.length - 1]).toEqual(d(2026, 12, 6));
    expect(days.length % 7).toBe(0);
  });

  it('shows a week from Monday, and a day on its own', () => {
    const week = viewDays('week', d(2026, 10, 29));
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual(d(2026, 10, 26));
    expect(viewDays('day', d(2026, 10, 29, 15))).toEqual([d(2026, 10, 29)]);
  });

  it('asks the BFF for the whole view', () => {
    const window = viewWindow('week', d(2026, 10, 29));
    expect(window.from).toBe(d(2026, 10, 26).toISOString());
    expect(window.to).toBe(d(2026, 11, 2).toISOString());
  });

  it('moves by a view at a time', () => {
    expect(shift('month', d(2026, 1, 31), 1)).toEqual(d(2026, 2, 1));
    expect(shift('week', d(2026, 10, 29), -1)).toEqual(d(2026, 10, 22));
    expect(shift('day', d(2026, 10, 31), 1)).toEqual(d(2026, 11, 1));
  });

  it('reads and writes the date in the URL', () => {
    expect(dayParam(d(2026, 3, 5))).toBe('2026-03-05');
    expect(parseDayParam('2026-03-05')).toEqual(d(2026, 3, 5));
    expect(parseDayParam('nope')).toBeNull();
  });
});

describe('placing changes', () => {
  const change = (start: Date, end: Date | null) => ({ start: start.toISOString(), end: end ? end.toISOString() : '' });

  it('puts a change on every day it runs, and one with no end on its start day', () => {
    const overnight = change(d(2026, 11, 2, 22), d(2026, 11, 3, 2));
    const open = change(d(2026, 11, 3, 9), null);
    expect(changesOn([overnight, open], d(2026, 11, 2))).toEqual([overnight]);
    expect(changesOn([overnight, open], d(2026, 11, 3))).toEqual([overnight, open]);
    expect(changesOn([overnight, open], d(2026, 11, 4))).toEqual([]);
  });

  it('finds the blackout windows covering a day', () => {
    const freeze = { start: d(2026, 12, 20).toISOString(), end: d(2027, 1, 3).toISOString() };
    expect(windowsOn([freeze], d(2026, 12, 19))).toEqual([]);
    expect(windowsOn([freeze], d(2026, 12, 25))).toEqual([freeze]);
    expect(windowsOn([freeze], d(2027, 1, 3))).toEqual([]);
  });

  it('tells upcoming, done and cancelled changes apart', () => {
    expect(statusLook('planned')).toBe('upcoming');
    expect(statusLook('closed')).toBe('done');
    expect(statusLook('not_approved')).toBe('cancelled');
  });
});
