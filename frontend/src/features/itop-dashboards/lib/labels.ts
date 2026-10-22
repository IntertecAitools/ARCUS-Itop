/**
 * Display text for dashboard tiles and chart axes.
 *
 * iTop's class labels are singular and title-cased ("Business Process"); a
 * tile counting them reads as a plural in sentence case ("Business
 * processes"). Acronyms keep their capitals ("IP phones", "VLANs").
 */

/** Words that have no plural in this context. */
const UNCOUNTABLE = new Set(['software', 'hardware', 'middleware', 'firmware', 'equipment', 'data']);

const isAcronym = (word: string) => word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);

function pluralWord(word: string): string {
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return word;
  if (isAcronym(word)) return word.endsWith('S') ? word : `${word}s`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** "Business Process" → "Business processes"; "PC" → "PCs"; "Software" → "Software". */
export function pluralLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return label;
  const cased = words.map((w, i) => (i === 0 || isAcronym(w) ? w : w.toLowerCase()));
  cased[cased.length - 1] = pluralWord(cased[cased.length - 1]!);
  return cased.join(' ');
}

/** A class name with no label of its own: "ApplicationSolution" → "Application Solution". */
export function splitClassName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

export type GroupKeyType = 'value' | 'day' | 'month' | 'year';

/**
 * A group key as the viewer reads it. Day keys are already the viewer's day
 * (the BFF counted them in the viewer's zone), so they are formatted as plain
 * calendar dates, not shifted again.
 */
export function formatGroupKey(key: string, label: string, keyType: GroupKeyType, locale?: string): string {
  if (keyType === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${key}T00:00:00Z`),
    );
  }
  if (keyType === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${key}-01T00:00:00Z`),
    );
  }
  return label;
}
