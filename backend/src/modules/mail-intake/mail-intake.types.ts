/** An email as the intake reads it, whatever the mailbox behind it. */
export interface InboundMail {
  /** The source's own id (Mailpit's message id, the IMAP UID). */
  id: string;
  /** The Message-ID header, for de-duplication across runs. */
  messageId: string;
  from: { address: string; name: string };
  subject: string;
  /** The text part, or the HTML part made into text. */
  text: string;
  /** Header names lower-cased, values joined. */
  headers: Record<string, string>;
}

/** A support mailbox. */
export interface MailSource {
  readonly kind: string;
  /** Messages not processed yet, oldest first, at most `limit`. */
  fetch(limit: number): Promise<InboundMail[]>;
  /** Marks a message done (read, or moved), so the next run skips it. */
  markProcessed(mail: InboundMail): Promise<void>;
  close?(): Promise<void>;
}

export type IntakeAction = "created" | "updated" | "skipped" | "failed";

export interface IntakeOutcome {
  messageId: string;
  from: string;
  subject: string;
  action: IntakeAction;
  /** The incident made or updated. */
  ref?: string;
  incidentId?: string;
  /** Why it was skipped or failed. */
  reason?: string;
}

export interface IntakeRun {
  startedAt: string;
  finishedAt: string;
  outcomes: IntakeOutcome[];
  /** Set when the mailbox itself could not be read. */
  error?: string;
}

export interface IntakeStatus {
  enabled: boolean;
  source?: string;
  address?: string;
  intervalSeconds?: number;
  lastRun?: IntakeRun;
  totals: Record<IntakeAction, number>;
}
