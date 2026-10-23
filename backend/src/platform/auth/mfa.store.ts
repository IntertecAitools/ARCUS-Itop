import type { Sealer } from "./seal.js";
import type { SqlPool } from "./session.mysql.js";

/** One account's authenticator enrolment. iTop has nowhere to keep it, so the BFF does. */
export interface MfaEnrolment {
  /** iTop User id. */
  userId: number;
  login: string;
  /** The TOTP shared secret, base32. Sealed whenever it is written down. */
  secret: string;
  enrolledAt: number;
}

/**
 * Where enrolments live: the BFF's memory, or the session database
 * (SESSION_STORE=mysql). Recovery codes are kept as SHA-256 hashes only.
 */
export interface MfaStore {
  get(userId: number): Promise<MfaEnrolment | undefined>;
  /** Saves an enrolment with its recovery codes, replacing any earlier one. */
  put(enrolment: MfaEnrolment, recoveryHashes: string[]): Promise<void>;
  /**
   * Records that a code of time step `step` was used. False when that step or
   * a later one was used already: a code works once.
   */
  useStep(userId: number, step: number): Promise<boolean>;
  /** Uses up a recovery code; false when it is not (or no longer) one of the account's. */
  useRecoveryCode(userId: number, hash: string): Promise<boolean>;
  recoveryCodesLeft(userId: number): Promise<number>;
  replaceRecoveryCodes(userId: number, hashes: string[]): Promise<void>;
  /** Removes the enrolment: the account enrols again at its next sign-in. */
  delete(userId: number): Promise<void>;
  ready(): Promise<void>;
}

interface Entry {
  enrolment: MfaEnrolment;
  lastStep: number;
  recovery: Set<string>;
}

export class MemoryMfaStore implements MfaStore {
  private readonly entries = new Map<number, Entry>();

  async get(userId: number): Promise<MfaEnrolment | undefined> {
    return this.entries.get(userId)?.enrolment;
  }

  async put(enrolment: MfaEnrolment, recoveryHashes: string[]): Promise<void> {
    this.entries.set(enrolment.userId, { enrolment, lastStep: -1, recovery: new Set(recoveryHashes) });
  }

  async useStep(userId: number, step: number): Promise<boolean> {
    const entry = this.entries.get(userId);
    if (!entry || step <= entry.lastStep) return false;
    entry.lastStep = step;
    return true;
  }

  async useRecoveryCode(userId: number, hash: string): Promise<boolean> {
    return this.entries.get(userId)?.recovery.delete(hash) ?? false;
  }

  async recoveryCodesLeft(userId: number): Promise<number> {
    return this.entries.get(userId)?.recovery.size ?? 0;
  }

  async replaceRecoveryCodes(userId: number, hashes: string[]): Promise<void> {
    const entry = this.entries.get(userId);
    if (entry) entry.recovery = new Set(hashes);
  }

  async delete(userId: number): Promise<void> {
    this.entries.delete(userId);
  }

  async ready(): Promise<void> {}
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS bff_mfa (
    user_id     INT UNSIGNED    NOT NULL PRIMARY KEY,
    login       VARCHAR(255)    NOT NULL,
    secret      VARBINARY(512)  NOT NULL,
    last_step   BIGINT          NOT NULL DEFAULT -1,
    enrolled_at BIGINT          NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS bff_mfa_recovery (
    user_id   INT UNSIGNED NOT NULL,
    code_hash CHAR(64)     NOT NULL,
    PRIMARY KEY (user_id, code_hash)
  ) ENGINE=InnoDB`,
];

interface Row {
  user_id: number;
  login: string;
  secret: Buffer;
  enrolled_at: number;
}

const affected = (result: unknown) => Number((result as { affectedRows?: number }).affectedRows ?? 0);

/**
 * Enrolments in the session database. The secret is sealed under
 * SESSION_SECRET and bound to its account, so the table alone yields no
 * usable secret and a row copied onto another account does not open.
 * Using a code and a recovery code are single conditional writes, so two BFF
 * instances cannot both accept the same one.
 */
export class MySqlMfaStore implements MfaStore {
  private initialised?: Promise<void>;

  constructor(
    private readonly pool: SqlPool,
    private readonly sealer: Sealer,
  ) {}

  ready(): Promise<void> {
    this.initialised ??= (async () => {
      for (const sql of TABLES) await this.pool.query(sql);
    })();
    return this.initialised;
  }

  async get(userId: number): Promise<MfaEnrolment | undefined> {
    await this.ready();
    const [rows] = await this.pool.query(
      "SELECT user_id, login, secret, enrolled_at FROM bff_mfa WHERE user_id = ?",
      [userId],
    );
    const row = (rows as Row[])[0];
    if (!row) return undefined;
    const secret = this.sealer.open(Buffer.from(row.secret), `mfa:${userId}`);
    // A row that does not open (tampered, or SESSION_SECRET changed) is no enrolment.
    if (!secret) return undefined;
    return { userId, login: row.login, secret, enrolledAt: Number(row.enrolled_at) };
  }

  async put(enrolment: MfaEnrolment, recoveryHashes: string[]): Promise<void> {
    await this.ready();
    const sealed = this.sealer.seal(enrolment.secret, `mfa:${enrolment.userId}`);
    await this.pool.query(
      "REPLACE INTO bff_mfa (user_id, login, secret, last_step, enrolled_at) VALUES (?, ?, ?, -1, ?)",
      [enrolment.userId, enrolment.login, sealed, enrolment.enrolledAt],
    );
    await this.replaceRecoveryCodes(enrolment.userId, recoveryHashes);
  }

  async useStep(userId: number, step: number): Promise<boolean> {
    await this.ready();
    const [result] = await this.pool.query(
      "UPDATE bff_mfa SET last_step = ? WHERE user_id = ? AND last_step < ?",
      [step, userId, step],
    );
    return affected(result) === 1;
  }

  async useRecoveryCode(userId: number, hash: string): Promise<boolean> {
    await this.ready();
    const [result] = await this.pool.query(
      "DELETE FROM bff_mfa_recovery WHERE user_id = ? AND code_hash = ?",
      [userId, hash],
    );
    return affected(result) === 1;
  }

  async recoveryCodesLeft(userId: number): Promise<number> {
    await this.ready();
    const [rows] = await this.pool.query("SELECT COUNT(*) AS n FROM bff_mfa_recovery WHERE user_id = ?", [userId]);
    return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  }

  async replaceRecoveryCodes(userId: number, hashes: string[]): Promise<void> {
    await this.ready();
    await this.pool.query("DELETE FROM bff_mfa_recovery WHERE user_id = ?", [userId]);
    for (const hash of hashes) {
      await this.pool.query("INSERT INTO bff_mfa_recovery (user_id, code_hash) VALUES (?, ?)", [userId, hash]);
    }
  }

  async delete(userId: number): Promise<void> {
    await this.ready();
    await this.pool.query("DELETE FROM bff_mfa_recovery WHERE user_id = ?", [userId]);
    await this.pool.query("DELETE FROM bff_mfa WHERE user_id = ?", [userId]);
  }
}
