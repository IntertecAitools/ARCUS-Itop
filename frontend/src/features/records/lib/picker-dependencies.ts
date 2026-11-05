import type { ClassInfo, FieldSpec } from '../types';

/**
 * Pickers whose options depend on another field of the form: a ticket's caller
 * must belong to its organization (`SELECT Person WHERE org_id = :this->org_id`).
 *
 * The BFF applies a flat filter like that one given the form's values. A filter
 * with a JOIN (a ticket's team, agent and service) is not applied by the BFF, so
 * those pickers are neither held back nor cleared: they'd wait on a parent
 * without narrowing anything.
 */
export function narrowsByParent(spec: FieldSpec): boolean {
  return Boolean(spec.filter?.includes(':this->') && !/\b(JOIN|BELOW)\b/i.test(spec.filter));
}

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
  if (!formValues || !narrowsByParent(spec)) return {};
  const context: Record<string, string> = {};
  for (const parent of spec.dependsOn ?? []) {
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
  if (!formValues || !narrowsByParent(spec)) return undefined;
  return spec.dependsOn?.find(
    (parent) => parent !== 'finalclass' && info.writable.includes(parent) && !isSet(formValues[parent]),
  );
}

/** The pickers whose choice stops being valid when this field changes. */
export function dependentsOf(info: ClassInfo, attcode: string): string[] {
  return Object.entries(info.fields)
    .filter(([, spec]) => narrowsByParent(spec) && spec.dependsOn?.includes(attcode))
    .map(([code]) => code);
}
