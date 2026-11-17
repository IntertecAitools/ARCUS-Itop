import type { Pool, RowDataPacket } from "mysql2/promise";
import type { LicenceState } from "./licence.types.js";

/**
 * The licence module's tables in the BFF database (SESSION_STORE=mysql), or
 * memory. Created on first use, like the other bff_* tables.
 *
 * - bff_installation: one row, this installation's id and report-signing key.
 * - bff_licences: every licence ever installed per scope; the newest wins.
 * - bff_licence_state: per scope, the latest time seen (clock check) and the state.
 * - bff_licence_events: the audit trail.
 *
 * A scope is a tenant id (TENANCY=on) or "installation".
 */
export const INSTALLATION_SCOPE = "installation";

export interface InstallationRow {
  id: string;
  createdAt: Date;
  /** The installation's report-signing key (usage reports, activation requests). */
  reportPublicKeyPem: string;
  /** Sealed with SESSION_SECRET in the database. */
  reportPrivateKeyPem: string;
}

export interface LicenceRow {
  id: number;
  scope: string;
  text: string;
  uploadedBy: string;
  uploadedAt: Date;
  eulaAcceptedBy: string | null;
  eulaAcceptedAt: Date | null;
}

export interface StateRow {
  scope: string;
  /** The latest time ever seen. */
  highWater: Date;
  state: LicenceState;
  graceStartedAt: Date | null;
}

export type LicenceEventType =
  | "key_uploaded"
  | "state_changed"
  | "clock_warning"
  | "tamper_detected"
  | "would_refuse"
  | "refused"
  | "limit_warning"
  | "eula_accepted"
  | "activation";

export interface LicenceEvent {
  id?: number;
  scope: string;
  at: Date;
  type: LicenceEventType;
  /** Who did it, when a person did. */
  actor: string | null;
  detail: string;
}

/** One scope's figures for one day (bff_usage_daily). */
export interface UsageDay {
  scope: string;
  day: string;
  agents: number;
  peakSessions: number;
  cis: number;
  /** AI requests made that day. */
  aiActions: number;
  /** Bytes stored that day (negative when removed); the storage in use is the sum. */
  storageBytes: number;
}

/** The daily figures (Build Guide, section 8): counted as they happen, kept two years. */
export interface UsageStore {
  addUsage(scope: string, day: string, delta: { aiActions?: number; storageBytes?: number }): Promise<void>;
  saveUsageDay(scope: string, day: string, figures: { agents?: number; peakSessions?: number; cis?: number }): Promise<void>;
  usageDays(scope: string, from: string, to: string): Promise<UsageDay[]>;
  /**
   * Drops figures before `before` (YYYY-MM-DD). Bytes stored on those days
   * are carried into the row of `before` first: storage in use is the sum
   * of every day's bytes, and files do not go away when their day is pruned.
   */
  pruneUsage(before: string): Promise<void>;
}

export interface LicenceStore extends UsageStore {
  /** The installation row, made on first call with `make` (a new id and key pair). */
  installation(make: () => Omit<InstallationRow, "createdAt">, now: Date): Promise<InstallationRow>;
  /** Every scope's licences, newest first. */
  licences(): Promise<LicenceRow[]>;
  addLicence(scope: string, text: string, by: string, at: Date): Promise<void>;
  /** Records the EULA (or SaaS terms) as accepted, on the scope's newest licence row. False when it has none. */
  acceptEula(scope: string, by: string, at: Date): Promise<boolean>;
  states(): Promise<StateRow[]>;
  /** Scopes whose licence names another cluster, since when (the 14-day re-activation window). */
  rebinds(): Promise<{ scope: string; startedAt: Date }[]>;
  saveRebind(scope: string, startedAt: Date | null): Promise<void>;
  saveState(row: StateRow): Promise<void>;
  addEvent(event: LicenceEvent): Promise<void>;
  events(scope: string, limit: number): Promise<LicenceEvent[]>;
  close?(): Promise<void>;
}

export class MemoryLicenceStore implements LicenceStore {
  private install?: InstallationRow;
  private readonly rows: LicenceRow[] = [];
  private readonly stateRows = new Map<string, StateRow>();
  private readonly eventRows: LicenceEvent[] = [];
  private nextId = 1;
  private readonly usage = new Map<string, UsageDay>();

  private day(scope: string, day: string): UsageDay {
    const key = `${scope}|${day}`;
    let row = this.usage.get(key);
    if (!row) {
      row = { scope, day, agents: 0, peakSessions: 0, cis: 0, aiActions: 0, storageBytes: 0 };
      this.usage.set(key, row);
    }
    return row;
  }
  async addUsage(scope: string, day: string, delta: { aiActions?: number; storageBytes?: number }) {
    const row = this.day(scope, day);
    row.aiActions += delta.aiActions ?? 0;
    row.storageBytes += delta.storageBytes ?? 0;
  }
  async saveUsageDay(scope: string, day: string, f: { agents?: number; peakSessions?: number; cis?: number }) {
    const row = this.day(scope, day);
    if (f.agents !== undefined) row.agents = f.agents;
    if (f.cis !== undefined) row.cis = f.cis;
    if (f.peakSessions !== undefined) row.peakSessions = Math.max(row.peakSessions, f.peakSessions);
  }
  async usageDays(scope: string, from: string, to: string) {
    return [...this.usage.values()].filter((r) => r.scope === scope && r.day >= from && r.day <= to).sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ ...r }));
  }
  async pruneUsage(before: string) {
    const carried = new Map<string, number>();
    for (const [k, r] of this.usage) {
      if (r.day >= before) continue;
      carried.set(r.scope, (carried.get(r.scope) ?? 0) + r.storageBytes);
      this.usage.delete(k);
    }
    for (const [scope, bytes] of carried) if (bytes !== 0) await this.addUsage(scope, before, { storageBytes: bytes });
  }

  async installation(make: () => Omit<InstallationRow, "createdAt">, now: Date) {
    this.install ??= { ...make(), createdAt: now };
    return { ...this.install };
  }
  async licences() {
    return [...this.rows].sort((a, b) => b.id - a.id).map((r) => ({ ...r }));
  }
  async addLicence(scope: string, text: string, by: string, at: Date) {
    this.rows.push({ id: this.nextId++, scope, text, uploadedBy: by, uploadedAt: at, eulaAcceptedBy: null, eulaAcceptedAt: null });
  }
  async acceptEula(scope: string, by: string, at: Date) {
    const newest = this.rows.filter((r) => r.scope === scope).sort((a, b) => b.id - a.id)[0];
    if (!newest) return false;
    newest.eulaAcceptedBy = by;
    newest.eulaAcceptedAt = at;
    return true;
  }
  private readonly rebindRows = new Map<string, Date>();
  async rebinds() {
    return [...this.rebindRows].map(([scope, startedAt]) => ({ scope, startedAt }));
  }
  async saveRebind(scope: string, startedAt: Date | null) {
    if (startedAt) this.rebindRows.set(scope, startedAt);
    else this.rebindRows.delete(scope);
  }
  async states() {
    return [...this.stateRows.values()].map((r) => ({ ...r }));
  }
  async saveState(row: StateRow) {
    this.stateRows.set(row.scope, { ...row });
  }
  async addEvent(event: LicenceEvent) {
    this.eventRows.push({ ...event, id: this.eventRows.length + 1 });
  }
  async events(scope: string, limit: number) {
    return this.eventRows.filter((e) => e.scope === scope).reverse().slice(0, limit);
  }
}

interface Sealer {
  seal(plain: string, binding: string): Buffer;
  open(data: Buffer, binding: string): string | undefined;
}

export class MySqlLicenceStore implements LicenceStore {
  private ready?: Promise<void>;
  constructor(
    private readonly pool: Pool,
    private readonly sealer: Sealer,
  ) {}

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_installation (
           singleton TINYINT NOT NULL PRIMARY KEY,
           id CHAR(36) NOT NULL,
           created_at DATETIME(3) NOT NULL,
           report_public_key TEXT NOT NULL,
           report_private_key BLOB NOT NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_licences (
           id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           scope VARCHAR(64) NOT NULL,
           licence_text TEXT NOT NULL,
           uploaded_by VARCHAR(200) NOT NULL,
           uploaded_at DATETIME(3) NOT NULL,
           eula_accepted_by VARCHAR(200) NULL,
           eula_accepted_at DATETIME(3) NULL,
           KEY bff_licences_scope (scope, id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_licence_state (
           scope VARCHAR(64) NOT NULL PRIMARY KEY,
           high_water DATETIME(3) NOT NULL,
           state VARCHAR(32) NOT NULL,
           grace_started_at DATETIME(3) NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_licence_rebind (
           scope VARCHAR(64) NOT NULL PRIMARY KEY,
           started_at DATETIME(3) NOT NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_usage_daily (
           scope VARCHAR(64) NOT NULL,
           day DATE NOT NULL,
           agents INT NOT NULL DEFAULT 0,
           peak_sessions INT NOT NULL DEFAULT 0,
           cis INT NOT NULL DEFAULT 0,
           ai_actions INT NOT NULL DEFAULT 0,
           storage_bytes BIGINT NOT NULL DEFAULT 0,
           PRIMARY KEY (scope, day)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_licence_events (
           id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           scope VARCHAR(64) NOT NULL,
           at DATETIME(3) NOT NULL,
           type VARCHAR(32) NOT NULL,
           actor VARCHAR(200) NULL,
           detail VARCHAR(2000) NOT NULL,
           KEY bff_licence_events_scope (scope, id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
    })();
    return this.ready;
  }

  async installation(make: () => Omit<InstallationRow, "createdAt">, now: Date): Promise<InstallationRow> {
    await this.init();
    const read = async () => {
      const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM bff_installation WHERE singleton = 1");
      const r = rows[0];
      if (!r) return undefined;
      const priv = this.sealer.open(r["report_private_key"] as Buffer, `installation:${r["id"] as string}`);
      if (priv === undefined) throw new Error("The installation's report key cannot be opened: SESSION_SECRET has changed.");
      return {
        id: r["id"] as string,
        createdAt: r["created_at"] as Date,
        reportPublicKeyPem: r["report_public_key"] as string,
        reportPrivateKeyPem: priv,
      };
    };
    const existing = await read();
    if (existing) return existing;
    const made = make();
    // INSERT IGNORE: two instances starting at once keep the first one's id.
    await this.pool.query(
      "INSERT IGNORE INTO bff_installation (singleton, id, created_at, report_public_key, report_private_key) VALUES (1, ?, ?, ?, ?)",
      [made.id, now, made.reportPublicKeyPem, this.sealer.seal(made.reportPrivateKeyPem, `installation:${made.id}`)],
    );
    return (await read())!;
  }

  async licences(): Promise<LicenceRow[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM bff_licences ORDER BY id DESC");
    return rows.map((r) => ({
      id: Number(r["id"]),
      scope: r["scope"] as string,
      text: r["licence_text"] as string,
      uploadedBy: r["uploaded_by"] as string,
      uploadedAt: r["uploaded_at"] as Date,
      eulaAcceptedBy: (r["eula_accepted_by"] as string | null) ?? null,
      eulaAcceptedAt: (r["eula_accepted_at"] as Date | null) ?? null,
    }));
  }

  async addLicence(scope: string, text: string, by: string, at: Date): Promise<void> {
    await this.init();
    await this.pool.query("INSERT INTO bff_licences (scope, licence_text, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?)", [scope, text, by, at]);
  }

  async acceptEula(scope: string, by: string, at: Date): Promise<boolean> {
    await this.init();
    const [res] = await this.pool.query<import("mysql2").ResultSetHeader>(
      "UPDATE bff_licences SET eula_accepted_by = ?, eula_accepted_at = ? WHERE scope = ? ORDER BY id DESC LIMIT 1",
      [by, at, scope],
    );
    return res.affectedRows === 1;
  }

  async rebinds(): Promise<{ scope: string; startedAt: Date }[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT scope, started_at FROM bff_licence_rebind");
    return rows.map((r) => ({ scope: r["scope"] as string, startedAt: r["started_at"] as Date }));
  }

  async saveRebind(scope: string, startedAt: Date | null): Promise<void> {
    await this.init();
    if (startedAt) await this.pool.query("INSERT IGNORE INTO bff_licence_rebind (scope, started_at) VALUES (?, ?)", [scope, startedAt]);
    else await this.pool.query("DELETE FROM bff_licence_rebind WHERE scope = ?", [scope]);
  }

  async states(): Promise<StateRow[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM bff_licence_state");
    return rows.map((r) => ({
      scope: r["scope"] as string,
      highWater: r["high_water"] as Date,
      state: r["state"] as LicenceState,
      graceStartedAt: (r["grace_started_at"] as Date | null) ?? null,
    }));
  }

  async saveState(row: StateRow): Promise<void> {
    await this.init();
    // GREATEST: another instance with a later clock never has its high water lowered.
    await this.pool.query(
      `INSERT INTO bff_licence_state (scope, high_water, state, grace_started_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE high_water = GREATEST(high_water, VALUES(high_water)), state = VALUES(state), grace_started_at = VALUES(grace_started_at)`,
      [row.scope, row.highWater, row.state, row.graceStartedAt],
    );
  }

  async addEvent(e: LicenceEvent): Promise<void> {
    await this.init();
    await this.pool.query("INSERT INTO bff_licence_events (scope, at, type, actor, detail) VALUES (?, ?, ?, ?, ?)", [
      e.scope,
      e.at,
      e.type,
      e.actor,
      e.detail.slice(0, 2000),
    ]);
  }

  async events(scope: string, limit: number): Promise<LicenceEvent[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM bff_licence_events WHERE scope = ? ORDER BY id DESC LIMIT ?", [scope, limit]);
    return rows.map((r) => ({
      id: Number(r["id"]),
      scope: r["scope"] as string,
      at: r["at"] as Date,
      type: r["type"] as LicenceEvent["type"],
      actor: (r["actor"] as string | null) ?? null,
      detail: r["detail"] as string,
    }));
  }

  async addUsage(scope: string, day: string, delta: { aiActions?: number; storageBytes?: number }): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_usage_daily (scope, day, ai_actions, storage_bytes) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ai_actions = ai_actions + VALUES(ai_actions), storage_bytes = storage_bytes + VALUES(storage_bytes)`,
      [scope, day, delta.aiActions ?? 0, delta.storageBytes ?? 0],
    );
  }

  async saveUsageDay(scope: string, day: string, f: { agents?: number; peakSessions?: number; cis?: number }): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_usage_daily (scope, day, agents, peak_sessions, cis) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         agents = IF(? IS NULL, agents, VALUES(agents)),
         cis = IF(? IS NULL, cis, VALUES(cis)),
         peak_sessions = GREATEST(peak_sessions, VALUES(peak_sessions))`,
      [scope, day, f.agents ?? 0, f.peakSessions ?? 0, f.cis ?? 0, f.agents ?? null, f.cis ?? null],
    );
  }

  async usageDays(scope: string, from: string, to: string): Promise<UsageDay[]> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT scope, DATE_FORMAT(day, '%Y-%m-%d') AS day, agents, peak_sessions, cis, ai_actions, storage_bytes FROM bff_usage_daily WHERE scope = ? AND day BETWEEN ? AND ? ORDER BY day",
      [scope, from, to],
    );
    return rows.map((r) => ({
      scope: r["scope"] as string,
      day: r["day"] as string,
      agents: Number(r["agents"]),
      peakSessions: Number(r["peak_sessions"]),
      cis: Number(r["cis"]),
      aiActions: Number(r["ai_actions"]),
      storageBytes: Number(r["storage_bytes"]),
    }));
  }

  async pruneUsage(before: string): Promise<void> {
    await this.init();
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>(
        "SELECT scope, SUM(storage_bytes) AS bytes FROM bff_usage_daily WHERE day < ? GROUP BY scope FOR UPDATE",
        [before],
      );
      for (const r of rows) {
        const bytes = Number(r["bytes"]);
        if (!bytes) continue;
        await conn.query(
          `INSERT INTO bff_usage_daily (scope, day, storage_bytes) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE storage_bytes = storage_bytes + VALUES(storage_bytes)`,
          [r["scope"], before, bytes],
        );
      }
      await conn.query("DELETE FROM bff_usage_daily WHERE day < ?", [before]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}
