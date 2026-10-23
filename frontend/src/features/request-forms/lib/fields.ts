import type { FormAnswers, FormField } from '../types';

/** The required fields still unanswered, so submit can wait until there are none. */
export function missingRequired(fields: FormField[], answers: FormAnswers): FormField[] {
  return fields.filter((f) => f.required && !(answers[f.key] ?? '').trim());
}

/** Only the answers this form asks, trimmed, empty ones left out. */
export function answersFor(fields: FormField[], answers: FormAnswers): FormAnswers {
  const out: FormAnswers = {};
  for (const f of fields) {
    const value = (answers[f.key] ?? '').trim();
    if (value) out[f.key] = value;
  }
  return out;
}

/**
 * A field key from its label ("Needed by?" -> "needed_by"), unique among
 * `taken`. Keys are what answers are stored under, so a field keeps the key
 * it was given even when its label is reworded later.
 */
export function keyFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+|_+$/g, '')
      .slice(0, 32) || 'field';
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** Options as one-per-line text for the editor, and back. */
export const optionsToText = (options: string[] | undefined) => (options ?? []).join('\n');
export const textToOptions = (text: string) =>
  text
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
