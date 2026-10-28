import type { ClassInfo, RecordDto } from '../types';

/** A value iTop would treat as "not set": empty, or 0 for a picker. */
function isEmpty(info: ClassInfo, attcode: string, value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  if (text === '') return true;
  return info.fields[attcode]?.ui === 'picker' && text === '0';
}

/**
 * The fields an action must ask for before it is applied.
 *
 * iTop's own stimulus form prompts for an attribute when the TARGET state
 * flags it `must_change` or `must_prompt`, or flags it `mandatory` while it
 * is still empty (application/cmdbabstract.class.inc.php:3048). Mirroring that
 * rule is what lets "Resolve" ask for a solution here instead of being sent
 * empty and refused.
 *
 * Only fields the BFF accepts on a write are returned: a computed field can
 * be flagged mandatory, but it is filled through its key, never directly.
 */
export function transitionPrompts(info: ClassInfo, record: RecordDto, action: string): string[] {
  const lifecycle = info.lifecycle;
  if (!lifecycle) return [];

  const state = String(record.fields[lifecycle.attribute] ?? '');
  const target = lifecycle.transitions[state]?.[action];
  if (!target) return [];

  const writable = new Set(info.writable);
  return Object.entries(lifecycle.flags[target] ?? {})
    .filter(([attcode, flags]) => {
      if (!writable.has(attcode) || attcode === lifecycle.attribute) return false;
      const ui = info.fields[attcode]?.ui;
      if (ui !== 'scalar' && ui !== 'picker') return false;
      if (flags.includes('must_change') || flags.includes('must_prompt')) return true;
      return flags.includes('mandatory') && isEmpty(info, attcode, record.fields[attcode]);
    })
    .map(([attcode]) => attcode);
}

/** Of the prompted fields, the ones the action cannot be applied without. */
export function requiredForTransition(info: ClassInfo, record: RecordDto, action: string) {
  const lifecycle = info.lifecycle;
  if (!lifecycle) return new Set<string>();
  const state = String(record.fields[lifecycle.attribute] ?? '');
  const target = lifecycle.transitions[state]?.[action];
  const flags = target ? (lifecycle.flags[target] ?? {}) : {};
  return new Set(
    transitionPrompts(info, record, action).filter((a) => flags[a]?.includes('mandatory')),
  );
}

/**
 * The actions to offer on a record in `state`: those iTop's lifecycle allows
 * there, that people take (not ev_timeout, ev_autoresolve and the like, which
 * iTop fires itself), and that the user's iTop profiles grant. The BFF
 * refuses the rest, so a button for one would always fail.
 */
export function offeredActions(info: ClassInfo, state: string): string[] {
  const lifecycle = info.lifecycle;
  if (!lifecycle) return [];
  const mayTake = new Set(lifecycle.allowedActions ?? lifecycle.userActions ?? lifecycle.stimuli);
  return (lifecycle.states[state] ?? []).filter((a) => mayTake.has(a));
}

/** Tickets whose hold also records the day someone acts on them again. */
const HOLD_WITH_DATE = new Set(['Incident', 'UserRequest']);

/**
 * Whether this action puts a ticket on hold (its target state is `pending`),
 * which then also asks for a next-action date. That field is the platform's
 * own (an iTop extension the schema does not list), so the dialog adds it
 * rather than the schema.
 */
export function asksNextActionDate(info: ClassInfo, record: RecordDto, action: string) {
  const lifecycle = info.lifecycle;
  if (!lifecycle || !HOLD_WITH_DATE.has(info.name)) return false;
  const state = String(record.fields[lifecycle.attribute] ?? '');
  return lifecycle.transitions[state]?.[action] === 'pending';
}
