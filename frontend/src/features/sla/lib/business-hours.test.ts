import { describe, expect, it } from 'vitest';
import { intervalProblems, PRESETS, summarise } from './business-hours';

describe('business-hours helpers', () => {
  it('folds consecutive days with the same hours', () => {
    expect(summarise(PRESETS[0]!.intervals)).toBe('Mon–Fri 09:00–17:00');
    expect(summarise(PRESETS[1]!.intervals)).toBe('Mon–Fri 08:00–20:00 · Sat 09:00–13:00');
    expect(summarise(PRESETS[2]!.intervals)).toBe('24x7');
    expect(
      summarise([
        { weekday: 'monday', start: '13:00', end: '17:00' },
        { weekday: 'monday', start: '08:00', end: '12:00' },
        { weekday: 'wednesday', start: '08:00', end: '12:00' },
      ]),
    ).toBe('Mon 08:00–12:00, 13:00–17:00 · Wed 08:00–12:00');
    expect(summarise([])).toBe('No open hours');
  });

  it('finds the same problems the BFF refuses', () => {
    expect(intervalProblems(PRESETS[2]!.intervals)).toEqual([]);
    expect(intervalProblems([{ weekday: 'monday', start: '17:00', end: '09:00' }])).toEqual([
      'Monday 17:00–09:00: the end must be after the start.',
    ]);
    expect(
      intervalProblems([
        { weekday: 'friday', start: '09:00', end: '12:00' },
        { weekday: 'friday', start: '11:30', end: '14:00' },
      ]),
    ).toEqual(['Friday: two periods overlap.']);
    expect(intervalProblems([{ weekday: 'monday', start: '', end: '09:00' }])).toEqual(['Monday: use HH:MM.']);
  });
});
