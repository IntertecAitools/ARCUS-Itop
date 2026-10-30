import type { BadgeTone } from '@/components/ui';
import type { AuditRule, AuditRuns, AuditStatus, CategoryResult } from '../types';
import { intlLocale } from '@/lib/i18n';

/**
 * Folds a run into what the screen already knows. A whole-category run
 * replaces that category; a one-rule run updates that rule only and leaves
 * the category's overall figure alone, since it no longer covers every rule.
 */
export function mergeRun(runs: AuditRuns, result: CategoryResult, wholeCategory: boolean): AuditRuns {
  const previous = runs[result.id];
  const rules = Object.fromEntries(result.rules.map((r) => [r.id, { ...r, ranAt: result.ranAt }]));
  if (wholeCategory) {
    return {
      ...runs,
      [result.id]: {
        ranAt: result.ranAt,
        total: result.total,
        summary: result.error
          ? undefined
          : { failing: result.failing, percentOk: result.percentOk, status: result.status },
        error: result.error,
        rules,
      },
    };
  }
  return {
    ...runs,
    [result.id]: {
      ranAt: result.ranAt,
      total: result.total,
      summary: previous?.summary,
      error: result.error,
      rules: { ...previous?.rules, ...rules },
    },
  };
}

export const STATUS_TONE: Record<AuditStatus, BadgeTone> = { good: 'good', warning: 'warning', bad: 'critical' };
export const STATUS_LABEL: Record<AuditStatus, string> = { good: 'Good', warning: 'Warning', bad: 'Needs work' };

/** "Lists faulty Servers" / "Lists valid Servers": how a rule decides. */
export function describeRule(rule: AuditRule, recordTypeLabel: string): string {
  const what = recordTypeLabel || 'records';
  return rule.lists === 'faulty'
    ? `Finds the ${what} records that are wrong`
    : `Finds the ${what} records that are right; the rest fail`;
}

/** 100 → "100%", 97.46 → "97.4%": rounded down, so a failure never shows as 100%. */
export function formatPercent(value: number): string {
  return `${Math.floor(value * 10 + 1e-9) / 10}%`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString(intlLocale())} ${word}${n === 1 ? '' : 's'}`;
}
