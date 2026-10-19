import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

import type { Caller } from "../../core/request-context.js";
import { isExpired, newSessionId, type SessionStore } from "./session.store.js";

/** The slice of a mysql2 pool this store uses, so tests can stand in for it. */
export interface SqlPool {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

interface Row {
  user_id: number;
  data: Buffer;
  created_at: number;
  last_seen: number;
}

/**
 * Writing last_seen on every request would turn each API call into a write.
 * Idle windows are measured in minutes, so a minute of slack costs nothing.
 */
const TOUCH_EVERY_MS = 60_000;

const TABLE = `
  CREATE TABLE IF NOT EXISTS bff_sessions (
    id_hash    CHAR(64)        NOT NULL PRIMARY KEY,
    user_id    INT UNSIGNED    NOT NULL,
    data       VARBINARY(8192) NOT NULL,
    created_at BIGINT          NOT NULL,
    last_seen  BIGINT          NOT NULL,
    KEY idx_user (user_id),
    KEY idx_last_seen (last_seen)
  ) ENGINE=InnoDB`;

/**
 * Sessions in a MySQL table: they survive a restart and every BFF instance
 * sees the same ones.
 *
 * What is written is protected twice over:
 * - the row key is a SHA-256 of the session id, so reading the table does not
 *   yield a cookie anyone could present;
 * - the caller (which holds the user's iTop password) is sealed with
 *   AES-256-GCM under a key derived from SESSION_SECRET, which lives in the
 *   BFF's environment and never in the database. A row that does not decrypt
 *   (tampered, or the secret changed) is no session at all;
 * - the seal is bound to its row (the id hash and user id are authenticated
 *   data), so copying another user's sealed blob into one's own row does not
 *   make one's cookie open it.
 */
export class MySqlSessionStore implements SessionStore {
  private readonly key: Buffer;
  private readonly sweeper: NodeJS.Timeout;
  private initialised?: Promise<void>;

  constructor(
    private readonly pool: SqlPool,
    secret: string,
    private readonly idleMs: number,
    private readonly maxMs: number,
    private readonly now: () => number = Date.now,
  ) {
    // A fixed salt is fine here: the secret is already high-entropy, and the
    // derivation only has to turn it into exactly 32 bytes.
    this.key = scryptSync(secret, "arcus-bff-sessions", 32);
    this.sweeper = setInterval(() => void this.sweep().catch(() => {}), 5 * 60_000);
    this.sweeper.unref();
  }

  ready(): Promise<void> {
    this.initialised ??= this.pool.query(TABLE).then(() => undefined);
    return this.initialised;
  }

  async create(caller: Caller): Promise<string> {
    await this.ready();
    const id = newSessionId();
    const hash = hashId(id);
    const at = this.now();
    await this.pool.query(
      "INSERT INTO bff_sessions (id_hash, user_id, data, created_at, last_seen) VALUES (?, ?, ?, ?, ?)",
      [hash, caller.userId, this.seal(caller, hash), at, at],
    );
    return id;
  }

  async get(id: string | undefined): Promise<Caller | undefined> {
    if (!id) return undefined;
    await this.ready();
    const hash = hashId(id);
    const [rows] = await this.pool.query(
      "SELECT user_id, data, created_at, last_seen FROM bff_sessions WHERE id_hash = ?",
      [hash],
    );
    const row = (rows as Row[])[0];
    if (!row) return undefined;

    const at = this.now();
    const times = { createdAt: Number(row.created_at), lastSeen: Number(row.last_seen) };
    const opened = isExpired(times, at, this.idleMs, this.maxMs)
      ? undefined
      : this.open(row.data, hash, Number(row.user_id));
    // The user id is authenticated data already; checking it again keeps a
    // mismatch from ever reaching a request.
    const caller = opened && opened.userId === Number(row.user_id) ? opened : undefined;
    if (!caller) {
      await this.pool.query("DELETE FROM bff_sessions WHERE id_hash = ?", [hash]);
      return undefined;
    }
    if (at - times.lastSeen >= TOUCH_EVERY_MS) {
      await this.pool.query("UPDATE bff_sessions SET last_seen = ? WHERE id_hash = ?", [at, hash]);
    }
    return caller;
  }

  async update(id: string, caller: Caller): Promise<void> {
    await this.ready();
    const hash = hashId(id);
    await this.pool.query("UPDATE bff_sessions SET data = ? WHERE id_hash = ? AND user_id = ?", [
      this.seal(caller, hash),
      hash,
      caller.userId,
    ]);
  }

  async delete(id: string | undefined): Promise<void> {
    if (!id) return;
    await this.ready();
    await this.pool.query("DELETE FROM bff_sessions WHERE id_hash = ?", [hashId(id)]);
  }

  async deleteForUser(userId: number): Promise<void> {
    await this.ready();
    await this.pool.query("DELETE FROM bff_sessions WHERE user_id = ?", [userId]);
  }

  private async sweep(): Promise<void> {
    await this.ready();
    const at = this.now();
    await this.pool.query("DELETE FROM bff_sessions WHERE last_seen < ? OR created_at < ?", [
      at - this.idleMs,
      at - this.maxMs,
    ]);
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    await this.pool.end();
  }

  /** iv (12) | auth tag (16) | ciphertext, bound to its row. */
  private seal(caller: Caller, hash: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(rowBinding(hash, caller.userId));
    const body = Buffer.concat([cipher.update(JSON.stringify(caller), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  private open(data: Buffer, hash: string, userId: number): Caller | undefined {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
      decipher.setAAD(rowBinding(hash, userId));
      decipher.setAuthTag(data.subarray(12, 28));
      const json = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
      return JSON.parse(json) as Caller;
    } catch {
      return undefined;
    }
  }
}

function rowBinding(hash: string, userId: number): Buffer {
  return Buffer.from(`${hash}:${userId}`, "utf8");
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}
