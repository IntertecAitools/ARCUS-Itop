import type { ObjectDto } from "../platform/objects/objects.service.js";

/**
 * The one place iTop's ticket vocabulary becomes ours.
 *
 * Every module that reads a ticket (dashboard, incidents, user-requests,
 * changes) maps through here, so a status can never read "In Progress" on one
 * screen and "Working" on another. Adding a state means editing this file and
 * nothing else.
 *
 * Nothing below this line leaks upward: the frontend never sees `assigned`,
 * `escalated_ttr`, `sla_ttr_passed` or a numeric priority.
 */

export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "pending"
  | "resolved"
  | "closed";

export type TicketPriority = "critical" | "high" | "medium" | "low";

/** iTop's Incident/UserRequest states, mapped onto the UI's vocabulary. */
export const STATUS_MAP: Record<string, TicketStatus> = {
  new: "new",
  assigned: "open",
  // Escalation is an SLA concern, not a separate workflow state for the user.
  escalated_tto: "open",
  escalated_ttr: "open",
  pending: "pending",
  resolved: "resolved",
  closed: "closed",
};

/** Our vocabulary back to iTop's, for filtering. One of ours can map to many. */
export const STATUS_TO_ITOP: Record<TicketStatus, string[]> = {
  new: ["new"],
  open: ["assigned", "escalated_tto", "escalated_ttr"],
  in_progress: ["assigned"],
  pending: ["pending"],
  resolved: ["resolved"],
  closed: ["closed"],
};

/** iTop stores priority as 1..4. */
export const PRIORITY_MAP: Record<string, TicketPriority> = {
  "1": "critical",
  "2": "high",
  "3": "medium",
  "4": "low",
};

export const PRIORITY_TO_ITOP: Record<TicketPriority, string> = {
  critical: "1",
  high: "2",
  medium: "3",
  low: "4",
};

/** Statuses that mean "still being worked". Used for open/queue counts. */
export const OPEN_STATES = "'new','assigned','escalated_tto','escalated_ttr','pending'";

export const str = (value: unknown): string => (value == null ? "" : String(value));

export const isTrue = (value: unknown): boolean =>
  value === "1" || value === 1 || value === true;

/** `YYYY-MM-DD HH:MM:SS`, the only datetime literal iTop's OQL accepts. */
export function oqlDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

/** The shape every list screen and every dashboard table renders. */
export interface TicketDto {
  id: string;
  ref: string;
  summary: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: { id: string; name: string };
  createdAt: string;
}

/** The output_fields a ticket row needs. Keep in step with `toTicket`. */
export const TICKET_FIELDS = "id,ref,title,status,priority,agent_id,agent_name,start_date";

export function toTicket(item: ObjectDto): TicketDto {
  const f = item.fields;
  const agentId = str(f["agent_id"]);
  const agentName = str(f["agent_name"]);
  return {
    id: String(item.id),
    ref: str(f["ref"]) || `#${item.id}`,
    summary: str(f["title"]),
    status: STATUS_MAP[str(f["status"])] ?? "open",
    priority: PRIORITY_MAP[str(f["priority"])] ?? "medium",
    // iTop uses 0 for "no link", which would otherwise render as a real person.
    ...(agentId && agentId !== "0" ? { assignee: { id: agentId, name: agentName } } : {}),
    createdAt: str(f["start_date"]),
  };
}

/** Escapes a value for an OQL string literal. */
export function oqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/* ------------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------------ */

/**
 * The actions a user can take, mapped onto iTop's stimuli.
 *
 * Only user-driven transitions are exposed. `ev_timeout` and `ev_autoresolve`
 * are fired by iTop's background tasks, so offering them as buttons would let
 * someone fake an SLA timeout.
 */
export const TRANSITIONS = {
  assign: { stimulus: "ev_assign", label: "Assign", requires: ["agent_id"] },
  reassign: { stimulus: "ev_reassign", label: "Reassign", requires: ["agent_id"] },
  hold: { stimulus: "ev_pending", label: "Put on hold", requires: [] },
  resolve: { stimulus: "ev_resolve", label: "Resolve", requires: ["solution"] },
  close: { stimulus: "ev_close", label: "Close", requires: [] },
  reopen: { stimulus: "ev_reopen", label: "Reopen", requires: [] },
} as const;

export type TransitionAction = keyof typeof TRANSITIONS;

export const TRANSITION_ACTIONS = Object.keys(TRANSITIONS) as TransitionAction[];

/** Reverse index: iTop stimulus -> our action name. */
const STIMULUS_TO_ACTION = new Map<string, TransitionAction>(
  TRANSITION_ACTIONS.map((action) => [TRANSITIONS[action].stimulus, action]),
);

/**
 * Which of our actions are legal from a RAW iTop state.
 *
 * Driven by the datamodel's own lifecycle rather than a hand-kept list, so it
 * cannot drift from what iTop will actually accept. Takes the raw state, not
 * our mapped status: our "open" covers three iTop states that each permit a
 * different set of stimuli.
 */
export function actionsForState(
  rawStatus: string,
  lifecycle: { states: Record<string, string[]> } | null,
): TransitionAction[] {
  const stimuli = lifecycle?.states?.[rawStatus] ?? [];
  return stimuli
    .map((stimulus) => STIMULUS_TO_ACTION.get(stimulus))
    .filter((action): action is TransitionAction => action !== undefined);
}

/* ------------------------------------------------------------------------ *
 * Enums iTop stores as numbers or snake_case
 * ------------------------------------------------------------------------ */

export const IMPACT_MAP: Record<string, string> = {
  "1": "department",
  "2": "service",
  "3": "person",
};

export const URGENCY_MAP: Record<string, string> = {
  "1": "critical",
  "2": "high",
  "3": "medium",
  "4": "low",
};

export const ORIGINS = [
  "in_person",
  "chat",
  "mail",
  "phone",
  "portal",
  "monitoring",
] as const;

export const RESOLUTION_CODES = [
  "assistance",
  "bug fixed",
  "hardware repair",
  "software patch",
  "system update",
  "training",
  "other",
] as const;

/**
 * iTop's CaseLog comes back either as a rendered string or as an object with
 * an `entries` array, depending on the REST version and the field. Normalising
 * both here keeps every caller from re-discovering that.
 */
export interface CaseLogEntry {
  date: string;
  author: string;
  message: string;
}

export function toCaseLog(value: unknown): CaseLogEntry[] {
  if (!value) return [];

  if (typeof value === "object" && value !== null && "entries" in value) {
    const entries = (value as { entries?: unknown }).entries;
    if (Array.isArray(entries)) {
      return entries.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        return {
          date: str(e["date"]),
          author: str(e["user_login"] ?? e["user_id_friendlyname"] ?? e["author"]),
          message: str(e["message"] ?? e["message_html"]),
        };
      });
    }
  }

  // A plain string is the whole log already rendered; keep it as one entry
  // rather than dropping it.
  const text = str(value);
  return text ? [{ date: "", author: "", message: text }] : [];
}
