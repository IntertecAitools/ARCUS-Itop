/** Mirrors the BFF's modules/auto-close/auto-close.types.ts. */

export interface AutoCloseSettings {
  enabled: boolean;
  /** Calendar days after resolution before the ticket closes. */
  days: number;
  requests: boolean;
  incidents: boolean;
  /** Email the caller before the ticket closes. */
  remind: boolean;
  /** How many days before closing the reminder goes; less than `days`. */
  remindDaysBefore: number;
}

export interface AutoCloseOutcome {
  class: 'UserRequest' | 'Incident';
  id: string;
  ref: string;
  action: 'closed' | 'reminded' | 'failed';
  reason?: string;
}

export interface AutoCloseRun {
  startedAt: string;
  finishedAt: string;
  outcomes: AutoCloseOutcome[];
  truncated: boolean;
  error?: string;
}

export interface AutoCloseDto extends AutoCloseSettings {
  mailConfigured: boolean;
  /** How often the server checks; 0 when the check is off on this server. */
  checkEveryMinutes: number;
  updatedAt: string;
  updatedBy: string;
  lastRun?: AutoCloseRun;
}
