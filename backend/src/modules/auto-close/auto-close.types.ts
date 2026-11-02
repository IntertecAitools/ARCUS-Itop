/** The ticket classes auto-close looks at: iTop's UserRequest and Incident. */
export type AutoCloseClass = "UserRequest" | "Incident";

/**
 * When a resolved ticket closes by itself, per tenant ("" without tenancy).
 * The customer can confirm (close) or reopen it until then.
 */
export interface AutoCloseSettings {
  enabled: boolean;
  /** Calendar days after resolution before the ticket closes. */
  days: number;
  /** Close resolved service requests. */
  requests: boolean;
  /** Close resolved incidents. */
  incidents: boolean;
  /** Email the caller before the ticket closes. */
  remind: boolean;
  /** How many days before closing the reminder goes; less than `days`. */
  remindDaysBefore: number;
}

/** One ticket a run closed, reminded about, or could not handle. */
export interface AutoCloseOutcome {
  class: AutoCloseClass;
  id: string;
  ref: string;
  action: "closed" | "reminded" | "failed";
  reason?: string;
}

export interface AutoCloseRun {
  startedAt: string;
  finishedAt: string;
  outcomes: AutoCloseOutcome[];
  /** More tickets were due than one run reads; the next run takes the rest. */
  truncated: boolean;
  error?: string;
}

export interface AutoCloseDto extends AutoCloseSettings {
  /** False when no mail server is configured, so `remind` sends nothing. */
  mailConfigured: boolean;
  /** How often the background check runs, in minutes; 0 when it is off on this server. */
  checkEveryMinutes: number;
  updatedAt: string;
  updatedBy: string;
  /** The last run for this tenant since the server started. */
  lastRun?: AutoCloseRun;
}
