import type { LinkedCi } from '@/features/cmdb';
import type { LinkedContact } from '@/features/contacts';
import type { KnownErrorSummary } from '@/features/knowledge-base';
import type { CaseLogEntry, LinkedTicket, TicketPriority } from '@/features/tickets';

/** iTop Problem lifecycle states */
export type ProblemStatus = 'new' | 'assigned' | 'resolved' | 'closed';
/** 1 A Department · 2 A Service · 3 A Person */
export type ProblemImpact = '1' | '2' | '3';
/** 1 Critical · 2 High · 3 Medium · 4 Low */
export type ProblemUrgency = '1' | '2' | '3' | '4';
/** Computed by iTop from impact × urgency. Read-only, never sent. */
export type ProblemPriority = TicketPriority;
export type ProblemStimulus = 'ev_assign' | 'ev_reassign' | 'ev_resolve' | 'ev_close';

/** Writable Problem attributes (iTop attribute codes) */
export type ProblemField =
  | 'org_id'
  | 'caller_id'
  | 'title'
  | 'description'
  | 'service_id'
  | 'servicesubcategory_id'
  | 'product'
  | 'impact'
  | 'urgency'
  | 'team_id'
  | 'agent_id'
  | 'related_change_id';

/** iTop attribute flags for a state, flattened */
export type FieldMode = 'hidden' | 'readonly' | 'optional' | 'mandatory';

/** Row returned by GET /problems */
export interface ProblemSummary {
  id: string;
  ref: string;
  title: string;
  status: ProblemStatus;
  priority: ProblemPriority;
  impact: ProblemImpact;
  urgency: ProblemUrgency;
  org_id: string;
  org_name: string;
  caller_id: string | null;
  caller_name: string | null;
  team_id: string | null;
  team_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  service_id: string | null;
  service_name: string | null;
  start_date: string;
  last_update: string;
}

/** Full problem from GET /problems/:id, including linked lists */
export interface Problem extends ProblemSummary {
  description: string;
  close_date: string | null;
  assignment_date: string | null;
  resolution_date: string | null;
  servicesubcategory_id: string | null;
  servicesubcategory_name: string | null;
  product: string;
  related_change_id: string | null;
  related_change_ref: string | null;
  private_log: CaseLogEntry[];
  functionalcis_list: LinkedCi[];
  contacts_list: LinkedContact[];
  knownerrors_list: KnownErrorSummary[];
  related_incident_list: LinkedTicket[];
  related_request_list: LinkedTicket[];
}

export type ProblemListTab = 'all' | 'open' | 'unassigned' | 'mine' | 'resolved' | 'closed';

/** List state; lives entirely in URL search params */
export interface ProblemFilters {
  tab: ProblemListTab;
  status: ProblemStatus[];
  priority: ProblemPriority[];
  impact: ProblemImpact[];
  urgency: ProblemUrgency[];
  orgId?: string;
  teamId?: string;
  agentId?: string;
  serviceId?: string;
  q?: string;
  /** YYYY-MM-DD, on start_date */
  from?: string;
  to?: string;
  /** attribute code, '-' prefix for descending */
  sort: string;
  page: number;
  pageSize: number;
}

export type StatsRange = '7d' | '30d' | '90d';

export interface KpiValue {
  value: number;
  /** Same measure one week earlier */
  previous: number;
}

/** GET /problems/stats */
export interface ProblemStats {
  range: StatsRange;
  kpis: {
    open: KpiValue;
    unassigned: KpiValue;
    resolvedThisWeek: KpiValue;
    knownErrors: KpiValue;
  };
  series: Array<{ date: string; created: number; resolved: number }>;
  byPriority: Array<{ priority: ProblemPriority; count: number }>;
  topServices: Array<{ service_id: string; service_name: string; count: number }>;
}

/** GET /problems/:id/transitions */
export interface ProblemTransition {
  stimulus: ProblemStimulus;
  target: ProblemStatus;
  required: ProblemField[];
  prompted: ProblemField[];
}

/** POST /problems. Never contains status or priority. */
export interface ProblemCreateInput {
  org_id: string;
  caller_id: string | null;
  title: string;
  description: string;
  service_id: string | null;
  servicesubcategory_id: string | null;
  product: string;
  impact: ProblemImpact;
  urgency: ProblemUrgency;
  functionalcis_list: Array<{ functionalci_id: string }>;
  contacts_list: Array<{ contact_id: string }>;
  related_incident_ids: string[];
}

/** PATCH /problems/:id: writable fields only */
export type ProblemUpdateInput = Partial<{
  org_id: string;
  caller_id: string | null;
  title: string;
  description: string;
  service_id: string | null;
  servicesubcategory_id: string | null;
  product: string;
  impact: ProblemImpact;
  urgency: ProblemUrgency;
  team_id: string | null;
  agent_id: string | null;
}>;

/** POST /problems/:id/transitions/:stimulus */
export interface TransitionInput {
  fields: Partial<Record<ProblemField, string | null>>;
  note?: string;
}

/** iTop Attachment metadata (item_class = Problem) */
export interface ProblemAttachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  creation_date: string;
}

export interface AttachmentContents {
  filename: string;
  mimetype: string;
  /** base64 */
  data: string;
}
