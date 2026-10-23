import { describe, expect, it } from 'vitest';
import { answersFor, keyFromLabel, missingRequired, textToOptions } from './fields';
import type { FormField } from '../types';

const fields: FormField[] = [
  { key: 'model', label: 'Model', type: 'choice', required: true, options: ['X1'] },
  { key: 'note', label: 'Note', type: 'text', required: false },
];

describe('request form fields', () => {
  it('lists required fields still unanswered', () => {
    expect(missingRequired(fields, { model: '  ' }).map((f) => f.key)).toEqual(['model']);
    expect(missingRequired(fields, { model: 'X1' })).toEqual([]);
  });

  it('sends only this form’s answers, trimmed and non-empty', () => {
    expect(answersFor(fields, { model: ' X1 ', note: '', stale: 'from another service' })).toEqual({ model: 'X1' });
  });

  it('makes a stable, unique key from a label', () => {
    expect(keyFromLabel('Needed by?', [])).toBe('needed_by');
    expect(keyFromLabel('Needed by', ['needed_by', 'needed_by_2'])).toBe('needed_by_3');
    expect(keyFromLabel('2nd screen', [])).toBe('nd_screen');
    expect(keyFromLabel('???', [])).toBe('field');
  });

  it('reads options one per line', () => {
    expect(textToOptions(' A \n\nB\n')).toEqual(['A', 'B']);
  });
});
