import type { Logger } from "../../itop/client.js";
import type { SqlPool } from "./session.mysql.js";

/** Everything worth a line in the sign-in audit log. */
export type SignInEvent =
  | "sign_in"
  | "sign_in_refused"
  | "mfa_failed"
  | "mfa_enrolled"
  | "recovery_code_used"
  | "recovery_codes_renewed"
  | "mfa_reset"
  | "break_glass_sign_in"
  | "break_glass_refused"
  | "break_glass_request";

export interface SignInAuditEntry {
  at: number;
  event: SignInEvent;
  /** The login as typed or resolved; the email for an SSO identity with no account. */
  login: string;
  userId?: number;
  method: "password" | "sso" | "break-glass" | "admin";
  /** The client address, as the request saw it (TRUST_PROXY decides how). */
  address?: string;
  /** Short and free of secrets: a reason, the request line, who reset whom. */
  detail?: string;
}

/**
 * The sign-in audit log: who signed in how, what was refused, every use of a
 * break-glass account. Each entry is also logged (at warn, `audit: true`) so
 * it reaches the log pipeline even when the store does not.
 */
export interface SignInAudit {
  record(entry: Omit<SignInAuditEntry, "at">): Promise<void>;
  /** Newest first. */
  list(options: { limit: number; before?: number; login?: string }): Promise<SignInAuditEntry[]>;
  ready(): Promise<void>;
}

/** How many entries the memory log keeps; the oldest go first. */
const MEMORY_LIMIT = 5_000;

export class MemorySignInAudit implements SignInAudit {
  private readonly entries: SignInAuditEntry[] = [];

  constructor(
    private readonly log?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async record(entry: Omit<SignInAuditEntry, "at">): Promise<void> {
    const full = { at: this.now(), ...entry };
    this.log?.warn({ audit: true, ...full }, `sign-in audit: ${entry.event}`);
    this.entries.push(full);
    if (this.entries.length > MEMORY_LIMIT) this.entries.shift();
  }

  async list(options: { limit: number; before?: number; login?: string }): Promise<SignInAuditEntry[]> {
    const login = options.login?.toLowerCase();
    return this.entries
      .filter((e) => (options.before === undefined || e.at < options.before) && (!login || e.login.toLowerCase() === login))
      .reverse()
      .slice(0, options.limit);
  }

  async ready(): Promise<void> {}
}

const TABLE = `
  CREATE TABLE IF NOT EXISTS bff_sign_in_audit (
    id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    at      BIGINT          NOT NULL,
    event   VARCHAR(40)     NOT NULL,
    login   VARCHAR(255)    NOT NULL,
    user_id INT UNSIGNED    NULL,
    method  VARCHAR(20)     NOT NULL,
    address VARCHAR(64)     NULL,
    detail  VARCHAR(500)    NULL,
    KEY idx_at (at),
    KEY idx_login (login)
  ) ENGINE=InnoDB`;

interface Row {
  at: number;
  event: SignInEvent;
  login: string;
  user_id: number | null;
  method: SignInAuditEntry["method"];
  address: string | null;
  detail: string | null;
}

/** The log in the session database: kept across restarts, shared by every instance. Never pruned. */
export class MySqlSignInAudit implements SignInAudit {
  private initialised?: Promise<void>;

  constructor(
    private readonly pool: SqlPool,
    private readonly log?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  ready(): Promise<void> {
    this.initialised ??= this.pool.query(TABLE).then(() => undefined);
    return this.initialised;
  }

  async record(entry: Omit<SignInAuditEntry, "at">): Promise<void> {
    const at = this.now();
    this.log?.warn({ audit: true, at, ...entry }, `sign-in audit: ${entry.event}`);
    await this.ready();
    await this.pool.query(
      "INSERT INTO bff_sign_in_audit (at, event, login, user_id, method, address, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        at,
        entry.event,
        entry.login.slice(0, 255),
        entry.userId ?? null,
        entry.method,
        entry.address?.slice(0, 64) ?? null,
        entry.detail?.slice(0, 500) ?? null,
      ],
    );
  }

  async list(options: { limit: number; before?: number; login?: string }): Promise<SignInAuditEntry[]> {
    await this.ready();
    const where: string[] = [];
    const values: unknown[] = [];
    if (options.before !== undefined) {
      where.push("at < ?");
      values.push(options.before);
    }
    if (options.login) {
      where.push("login = ?");
      values.push(options.login);
    }
    const [rows] = await this.pool.query(
      `SELECT at, event, login, user_id, method, address, detail FROM bff_sign_in_audit` +
        (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
        ` ORDER BY at DESC, id DESC LIMIT ?`,
      [...values, options.limit],
    );
    return (rows as Row[]).map((r) => ({
      at: Number(r.at),
      event: r.event,
      login: r.login,
      method: r.method,
      ...(r.user_id !== null ? { userId: Number(r.user_id) } : {}),
      ...(r.address !== null ? { address: r.address } : {}),
      ...(r.detail !== null ? { detail: r.detail } : {}),
    }));
  }
}
