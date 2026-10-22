import { describe, expect, it } from 'vitest';
import { formatGroupKey, pluralLabel, splitClassName } from './labels';

describe('pluralLabel', () => {
  it.each([
    ['Business Process', 'Business processes'],
    ['Application Solution', 'Application solutions'],
    ['Network Device', 'Network devices'],
    ['Contact', 'Contacts'],
    ['Tape Library', 'Tape libraries'],
    ['SAN Switch', 'SAN switches'],
    ['PC', 'PCs'],
    ['NAS', 'NAS'],
    ['IP Phone', 'IP phones'],
    ['Software', 'Software'],
    ['OS Family', 'OS families'],
    ['Patch', 'Patches'],
  ])('%s → %s', (label, plural) => {
    expect(pluralLabel(label)).toBe(plural);
  });
});

describe('splitClassName', () => {
  it('spaces a class name that has no label', () => {
    expect(splitClassName('ApplicationSolution')).toBe('Application Solution');
    expect(splitClassName('IPPhone')).toBe('IP Phone');
  });
});

describe('formatGroupKey', () => {
  it('shows a day key as a date, without shifting it', () => {
    expect(formatGroupKey('2026-10-19', '2026-10-19', 'day', 'en-GB')).toBe('19 Oct');
  });

  it('leaves a plain value to its label', () => {
    expect(formatGroupKey('3', 'Sam Agent', 'value')).toBe('Sam Agent');
  });
});
