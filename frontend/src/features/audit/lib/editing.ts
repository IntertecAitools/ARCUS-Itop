/** Pure helpers for the category and rule editors. */

/** What to run when the Audit screen opens: `?run=category:10` or `?run=rule:20`. */
export type RunRequest = { kind: 'category' | 'rule'; id: number };

export function runParam(target: RunRequest): string {
  return `${target.kind}:${target.id}`;
}

export function parseRunParam(value: string | null): RunRequest | null {
  const m = /^(category|rule):(\d+)$/.exec(value ?? '');
  return m ? { kind: m[1] as RunRequest['kind'], id: Number(m[2]) } : null;
}

/** Why a pair of tolerances cannot be saved, or null. */
export function toleranceProblem(good: number, warning: number): string | null {
  if (![good, warning].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) {
    return 'Tolerances are whole percentages from 0 to 100.';
  }
  if (warning < good) return 'The warning tolerance must be at least the good one.';
  return null;
}

/** The question asked before a category is deleted: its rules go with it. */
export function deleteCategoryQuestion(category: { name: string; rules: Array<{ name: string }> }): string {
  const { name, rules } = category;
  if (rules.length === 0) return `Delete the category “${name}”?`;
  const listed = rules.map((r) => `• ${r.name}`).join('\n');
  return `Delete the category “${name}”? Its ${rules.length === 1 ? 'rule goes' : `${rules.length} rules go`} with it:\n${listed}`;
}
