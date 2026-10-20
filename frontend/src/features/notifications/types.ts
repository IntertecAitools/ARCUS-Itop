// notifications: feature types. Mirrors the BFF's /api/admin/notifications.
import type { Criterion } from '@/features/records';

export type EditableEvent =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'state_entered'
  | 'state_left'
  | 'sla_threshold';
export type EventKind = EditableEvent | 'mentioned' | 'portal_update' | 'other';

export type Role = 'caller' | 'agent' | 'team' | 'mentioned';
export type EmailStatus = 'on' | 'test' | 'off';

export type Recipient =
  | { kind: Role }
  | { kind: 'people'; people: Array<{ id: number; name: string }> }
  /** Part of a list set up before this screen existed; kept as it is. */
  | { kind: 'custom'; index: number };

export type RecipientInput =
  | { kind: Role }
  | { kind: 'people'; ids: number[] }
  | { kind: 'custom'; index: number };

export interface RuleEvent {
  kind: EventKind;
  recordType: string;
  state?: string;
  fields?: string[];
  sla?: { timer: string; percent: string };
  hasCondition: boolean;
  /** The "only when…" conditions this screen can edit. */
  conditions: Criterion[];
  /** Part of the condition was set up in iTop in a form not shown here; it is kept. */
  keptCondition: boolean;
  /** Names for record ids in conditions, keyed "field:id". */
  valueLabels: Record<string, string>;
  /** False for events only iTop's own screens raise; nothing here fires them. */
  firesFromPlatform: boolean;
  /** Display names for the codes above. */
  labels?: { recordType: string; state?: string; fields?: string[] };
}

export interface Rule {
  id: number;
  name: string;
  event: RuleEvent;
  email: {
    to: Recipient[];
    cc: Recipient[];
    subject: string;
    body: string;
    status: EmailStatus;
    testRecipient: string;
    sharedWith: number;
  };
}

export interface RuleInput {
  name: string;
  event: {
    kind: EditableEvent;
    recordType: string;
    state?: string;
    fields?: string[];
    sla?: { timer: string; percent: string };
    conditions?: Criterion[];
    /** Keep the part of the condition set up in iTop (default true). */
    keepCondition?: boolean;
  };
  email: {
    to: RecipientInput[];
    cc: RecipientInput[];
    subject: string;
    body: string;
    status: EmailStatus;
    testRecipient?: string;
  };
}

export interface RecordType {
  name: string;
  label: string;
  ticket: boolean;
}

export interface Choice {
  code: string;
  label: string;
}

export interface RuleOptions {
  recordTypes: RecordType[];
  states?: Choice[];
  fields?: Choice[];
  slaTimers?: Choice[];
  slaPercents?: string[];
  roles?: Role[];
  tokens?: Array<{ token: string; label: string }>;
}

export interface SentEmail {
  id: number;
  date: string;
  to: string;
  subject: string;
  result: string;
  rule: string;
  record: { type: string; id: number } | null;
}
