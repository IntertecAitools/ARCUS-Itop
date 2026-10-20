import type { EventKind, Recipient, Role, RuleEvent } from '../types';

export const EVENT_LABEL: Record<EventKind, string> = {
  created: 'is created',
  updated: 'is changed',
  deleted: 'is deleted',
  state_entered: 'enters a status',
  state_left: 'leaves a status',
  sla_threshold: 'reaches an SLA threshold',
  mentioned: 'mentions someone in iTop’s editor',
  portal_update: 'is updated from iTop’s portal',
  other: 'has another event set up in iTop',
};

export const ROLE_LABEL: Record<Role, string> = {
  caller: 'The caller',
  agent: 'The assigned agent',
  team: 'The assigned team',
  mentioned: 'The person mentioned',
};

const TIMER_LABEL: Record<string, string> = { tto: 'time to own', ttr: 'time to resolve' };

/** "A User Request enters Resolved", from a rule's event and the labels to hand. */
export function describeEvent(
  event: RuleEvent,
  given: { recordType?: string; state?: string; fields?: string[] } = {},
): string {
  const labels = { ...event.labels, ...given };
  const what = labels.recordType ?? event.recordType;
  // "An Incident", but "A User Request": a leading u often sounds like "you".
  const article = /^([aeio]|u(?![sn]))/i.test(what) ? 'An' : 'A';
  const subject = `${article} ${what}`;
  switch (event.kind) {
    case 'state_entered':
      return `${subject} enters ${labels.state ?? event.state ?? 'a status'}`;
    case 'state_left':
      return `${subject} leaves ${labels.state ?? event.state ?? 'a status'}`;
    case 'updated': {
      const fields = labels.fields ?? event.fields ?? [];
      return fields.length ? `${subject}’s ${fields.join(' or ')} changes` : `${subject} is changed`;
    }
    case 'sla_threshold': {
      const timer = TIMER_LABEL[event.sla?.timer ?? ''] ?? event.sla?.timer ?? 'SLA';
      return `${subject} reaches ${event.sla?.percent ?? '?'}% of its ${timer}`;
    }
    default:
      return `${subject} ${EVENT_LABEL[event.kind]}`;
  }
}

/** "The caller, Jane Doe" for a recipient list. */
export function describeRecipients(recipients: Recipient[]): string {
  if (!recipients.length) return '—';
  return recipients
    .map((r) =>
      r.kind === 'people'
        ? r.people.map((p) => p.name).join(', ')
        : r.kind === 'custom'
          ? 'A list set up in iTop'
          : ROLE_LABEL[r.kind],
    )
    .join(', ');
}

/** Inserts `{{token}}` at the cursor of a text the user is editing. */
export function insertToken(
  text: string,
  token: string,
  selection: { start: number; end: number } | null,
): { text: string; cursor: number } {
  const insert = `{{${token}}}`;
  const start = selection?.start ?? text.length;
  const end = selection?.end ?? text.length;
  return { text: text.slice(0, start) + insert + text.slice(end), cursor: start + insert.length };
}
