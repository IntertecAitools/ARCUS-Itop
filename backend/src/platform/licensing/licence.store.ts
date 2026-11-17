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
  | "eula_accepted";

export interface LicenceEvent {
  id?: number;
  scope: string;
  at: Date;
  type: LicenceEventType;
  /** Who did it, when a person did. */
  actor: string | null;
  detail: string;
}

export interface LicenceStore {
  /** The installation row, made on first call with `make` (a new id and key pair). */
  installation(make: () => Omit<InstallationRow, "createdAt">, now: Date): Promise<InstallationRow>;
  /** Every scope's licences, newest first. */
  licences(): Promise<LicenceRow[]>;
  addLicence(scope: string, text: string, by: string, at: Date): Promise<void>;
  states(): Promise<StateRow[]>;
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
}
