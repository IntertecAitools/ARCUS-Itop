import type { ClassInfo, FieldSpec } from '../types';

/**
 * Pickers whose options depend on another field of the form: a ticket's caller
 * must belong to its organization. The BFF says which (`narrowedBy`) and applies
 * the rule given the form's values. A picker whose rule it can't apply (a ticket's
 * team, agent and service) has no `narrowedBy`, so it is neither held back nor
 * cleared: it would wait on a parent without narrowing anything.
 */

/** iTop's "no link" is 0, a blank form field is ''. */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== '0' && value !== 0;
}

/** The form values a picker's options depend on, to send with its request. */
export function pickerContext(
  className: string,
  spec: FieldSpec,
  formValues: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!formValues) return {};
  const context: Record<string, string> = {};
  for (const parent of spec.narrowedBy ?? []) {
    if (parent === 'finalclass') context[parent] = className;
    else if (isSet(formValues[parent])) context[parent] = String(formValues[parent]);
  }
  return context;
}

/**
 * The field to fill in before this picker means anything, if any. Only one the
 * user can fill: a parent that isn't writable here would hold it back for good.
 */
export function unsetParent(
  info: ClassInfo,
  spec: FieldSpec,
  formValues: Record<string, unknown> | undefined,
): string | undefined {
  if (!formValues) return undefined;
  return spec.narrowedBy?.find(
    (parent) => parent !== 'finalclass' && info.writable.includes(parent) && !isSet(formValues[parent]),
  );
}

/** The pickers whose choice stops being valid when this field changes. */
export function dependentsOf(info: ClassInfo, attcode: string): string[] {
  return Object.entries(info.fields)
    .filter(([, spec]) => spec.narrowedBy?.includes(attcode))
    .map(([code]) => code);
}
