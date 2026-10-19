import type { SqlPool } from "./session.mysql.js";

/**
 * One-time password-reset links, stored by the SHA-256 of their token: the
 * store never holds a token anyone could use.
 */
export interface ResetTokenStore {
  put(tokenHash: string, userId: number, expiresAt: number): Promise<void>;
  /** The account a live token belongs to, without using it up. */
  peek(tokenHash: string): Promise<number | undefined>;
  /** Every link of the account stops working: after a reset, or a new request. */
  deleteForUser(userId: number): Promise<void>;
  ready(): Promise<void>;
}

export class MemoryResetTokenStore implements ResetTokenStore {
  private readonly tokens = new Map<string, { userId: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async put(tokenHash: string, userId: number, expiresAt: number): Promise<void> {
    this.tokens.set(tokenHash, { userId, expiresAt });
  }

  async peek(tokenHash: string): Promise<number | undefined> {
    const token = this.tokens.get(tokenHash);
    if (!token) return undefined;
    if (token.expiresAt <= this.now()) {
      this.tokens.delete(tokenHash);
      return undefined;
    }
    return token.userId;
  }

  async deleteForUser(userId: number): Promise<void> {
    for (const [hash, token] of this.tokens) {
      if (token.userId === userId) this.tokens.delete(hash);
    }
  }

  async ready(): Promise<void> {}
}

const TABLE = `
  CREATE TABLE IF NOT EXISTS bff_password_resets (
    token_hash CHAR(64)     NOT NULL PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    expires_at BIGINT       NOT NULL,
    KEY idx_user (user_id),
    KEY idx_expires (expires_at)
  ) ENGINE=InnoDB`;

/** Reset links in the session database, so they survive restarts and instances. */
export class MySqlResetTokenStore implements ResetTokenStore {
  private initialised?: Promise<void>;

  constructor(
    private readonly pool: SqlPool,
    private readonly now: () => number = Date.now,
  ) {}

  ready(): Promise<void> {
    this.initialised ??= this.pool.query(TABLE).then(() => undefined);
    return this.initialised;
  }

  async put(tokenHash: string, userId: number, expiresAt: number): Promise<void> {
    await this.ready();
    // Expired links are swept here: requests are rare, so no timer is needed.
    await this.pool.query("DELETE FROM bff_password_resets WHERE expires_at <= ?", [this.now()]);
    await this.pool.query(
      "INSERT INTO bff_password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
      [tokenHash, userId, expiresAt],
    );
  }

  async peek(tokenHash: string): Promise<number | undefined> {
    await this.ready();
    const [rows] = await this.pool.query(
      "SELECT user_id FROM bff_password_resets WHERE token_hash = ? AND expires_at > ?",
      [tokenHash, this.now()],
    );
    const row = (rows as Array<{ user_id: number }>)[0];
    return row ? Number(row.user_id) : undefined;
  }

  async deleteForUser(userId: number): Promise<void> {
    await this.ready();
    await this.pool.query("DELETE FROM bff_password_resets WHERE user_id = ?", [userId]);
  }
}
