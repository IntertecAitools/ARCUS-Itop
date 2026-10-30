import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { TicketPriority } from "../../shared/ticket-mapping.js";
import type { HandledClass, PriorityOverride, WorklogEntry } from "./ticket-handling.types.js";

/**
 * What the BFF keeps for these features, in its own database (the one
 * sessions use, never iTop's):
 *
 * - priority overrides: who, why and what impact/urgency were before. iTop
 *   holds the outcome (the new impact/urgency, so the new priority) and the
 *   reason in the private log; this is the record the ticket screen shows.
 * - worklogs: iTop 3.4 has nowhere to log time per agent and entry
 *   (Ticket.time_spent is one duration iTop sets itself on resolve, and a
 *   WorkOrder is a task that needs a team and fake start/end times), so the
 *   entries live here, keyed by ticket.
 *
 * Every row carries the tenant it was written under; reads filter on it.
 */

export interface StoredOverride extends Omit<PriorityOverride, "active"> {
  tenant: string;
  class: HandledClass;
  ticketId: number;
}

export interface NewWorklog {
  tenant: string;
  class: HandledClass;
  ticketId: number;
  ticketRef: string;
  orgId: number;
  agent: WorklogEntry["agent"];
  minutes: number;
  note: string;
  workDate: string;
}

export interface WorklogFilter {
  tenant: string;
  class?: HandledClass;
  ticketId?: number;
  userId?: number;
  from?: string;
  to?: string;
  /** Only tickets of these organisations; empty means any. */
  orgIds?: number[];
}

export interface StoredWorklog extends WorklogEntry {
  tenant: string;
  orgId: number;
}

export interface TicketHandlingStore {
  saveOverride(override: StoredOverride): Promise<void>;
  /** The latest override of a ticket. */
  latestOverride(tenant: string, cls: HandledClass, ticketId: number): Promise<StoredOverride | undefined>;
  addWorklog(entry: NewWorklog): Promise<StoredWorklog>;
  getWorklog(tenant: string, id: number): Promise<StoredWorklog | undefined>;
  deleteWorklog(tenant: string, id: number): Promise<void>;
  listWorklogs(filter: WorklogFilter): Promise<StoredWorklog[]>;
}

function matches(entry: StoredWorklog, f: WorklogFilter): boolean {
  return (
    entry.tenant === f.tenant &&
    (f.class === undefined || entry.class === f.class) &&
    (f.ticketId === undefined || entry.ticketId === f.ticketId) &&
    (f.userId === undefined || entry.agent.userId === f.userId) &&
    (f.from === undefined || entry.workDate >= f.from) &&
    (f.to === undefined || entry.workDate <= f.to) &&
    (!f.orgIds?.length || f.orgIds.includes(entry.orgId))
  );
}

/** In memory: tests, and SESSION_STORE=memory (lost on restart, like sessions). */
export class MemoryTicketHandlingStore implements TicketHandlingStore {
  private readonly overrides: StoredOverride[] = [];
  private readonly worklogs: StoredWorklog[] = [];
  private nextId = 1;

  async saveOverride(override: StoredOverride): Promise<void> {
    this.overrides.push(override);
  }

  async latestOverride(tenant: string, cls: HandledClass, ticketId: number) {
    return this.overrides.findLast((o) => o.tenant === tenant && o.class === cls && o.ticketId === ticketId);
  }

  async addWorklog(entry: NewWorklog): Promise<StoredWorklog> {
    const stored: StoredWorklog = { ...entry, id: this.nextId++, createdAt: new Date().toISOString() };
    this.worklogs.push(stored);
    return stored;
  }

  async getWorklog(tenant: string, id: number) {
    return this.worklogs.find((w) => w.tenant === tenant && w.id === id);
  }

  async deleteWorklog(tenant: string, id: number): Promise<void> {
    const at = this.worklogs.findIndex((w) => w.tenant === tenant && w.id === id);
    if (at >= 0) this.worklogs.splice(at, 1);
  }

  async listWorklogs(filter: WorklogFilter): Promise<StoredWorklog[]> {
    return this.worklogs.filter((w) => matches(w, filter));
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const day = (v: unknown) => {
  if (v instanceof Date) {
    // A DATE column comes back as local midnight; keep the calendar day.
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v ?? "").slice(0, 10);
};

/** Tables `bff_priority_overrides` and `bff_worklogs`, created on first use. */
export class MySqlTicketHandlingStore implements TicketHandlingStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_priority_overrides (
           id INT AUTO_INCREMENT PRIMARY KEY,
           tenant VARCHAR(64) NOT NULL DEFAULT '',
           class VARCHAR(32) NOT NULL,
           ticket_id INT NOT NULL,
           priority_from VARCHAR(16) NOT NULL,
           priority_to VARCHAR(16) NOT NULL,
           impact_from VARCHAR(8) NOT NULL,
           urgency_from VARCHAR(8) NOT NULL,
           impact_to VARCHAR(8) NOT NULL,
           urgency_to VARCHAR(8) NOT NULL,
           reason TEXT NOT NULL,
           by_name VARCHAR(255) NOT NULL,
           at DATETIME(3) NOT NULL,
           KEY ticket (tenant, class, ticket_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS bff_worklogs (
           id INT AUTO_INCREMENT PRIMARY KEY,
           tenant VARCHAR(64) NOT NULL DEFAULT '',
           class VARCHAR(32) NOT NULL,
           ticket_id INT NOT NULL,
           ticket_ref VARCHAR(64) NOT NULL DEFAULT '',
           org_id INT NOT NULL DEFAULT 0,
           user_id INT NOT NULL,
           contact_id INT NOT NULL DEFAULT 0,
           agent_name VARCHAR(255) NOT NULL DEFAULT '',
           minutes INT NOT NULL,
           note TEXT NOT NULL,
           work_date DATE NOT NULL,
           created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           KEY ticket (tenant, class, ticket_id),
           KEY agent (tenant, user_id, work_date)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
    })().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async saveOverride(o: StoredOverride): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO bff_priority_overrides
         (tenant, class, ticket_id, priority_from, priority_to, impact_from, urgency_from, impact_to, urgency_to, reason, by_name, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.tenant, o.class, o.ticketId, o.from, o.to, o.impactFrom, o.urgencyFrom, o.impactTo, o.urgencyTo, o.reason, o.by, new Date(o.at)],
    );
  }

  async latestOverride(tenant: string, cls: HandledClass, ticketId: number) {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM bff_priority_overrides WHERE tenant = ? AND class = ? AND ticket_id = ? ORDER BY id DESC LIMIT 1`,
      [tenant, cls, ticketId],
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      tenant,
      class: cls,
      ticketId,
      from: String(r["priority_from"]) as TicketPriority,
      to: String(r["priority_to"]) as TicketPriority,
      impactFrom: String(r["impact_from"]),
      urgencyFrom: String(r["urgency_from"]),
      impactTo: String(r["impact_to"]),
      urgencyTo: String(r["urgency_to"]),
      reason: String(r["reason"]),
      by: String(r["by_name"]),
      at: iso(r["at"]),
    };
  }

  private toWorklog(r: RowDataPacket): StoredWorklog {
    return {
      id: Number(r["id"]),
      tenant: String(r["tenant"]),
      class: String(r["class"]) as HandledClass,
      ticketId: Number(r["ticket_id"]),
      ticketRef: String(r["ticket_ref"]),
      orgId: Number(r["org_id"]),
      agent: { userId: Number(r["user_id"]), contactId: Number(r["contact_id"]), name: String(r["agent_name"]) },
      minutes: Number(r["minutes"]),
      note: String(r["note"]),
      workDate: day(r["work_date"]),
      createdAt: iso(r["created_at"]),
    };
  }

  async addWorklog(e: NewWorklog): Promise<StoredWorklog> {
    await this.init();
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO bff_worklogs (tenant, class, ticket_id, ticket_ref, org_id, user_id, contact_id, agent_name, minutes, note, work_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.tenant, e.class, e.ticketId, e.ticketRef, e.orgId, e.agent.userId, e.agent.contactId, e.agent.name, e.minutes, e.note, e.workDate],
    );
    const stored = await this.getWorklog(e.tenant, result.insertId);
    if (!stored) throw new Error("The worklog entry was not saved.");
    return stored;
  }

  async getWorklog(tenant: string, id: number) {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM bff_worklogs WHERE tenant = ? AND id = ?", [tenant, id]);
    return rows[0] ? this.toWorklog(rows[0]) : undefined;
  }

  async deleteWorklog(tenant: string, id: number): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM bff_worklogs WHERE tenant = ? AND id = ?", [tenant, id]);
  }

  async listWorklogs(f: WorklogFilter): Promise<StoredWorklog[]> {
    await this.init();
    const where = ["tenant = ?"];
    const args: unknown[] = [f.tenant];
    if (f.class !== undefined) (where.push("class = ?"), args.push(f.class));
    if (f.ticketId !== undefined) (where.push("ticket_id = ?"), args.push(f.ticketId));
    if (f.userId !== undefined) (where.push("user_id = ?"), args.push(f.userId));
    if (f.from !== undefined) (where.push("work_date >= ?"), args.push(f.from));
    if (f.to !== undefined) (where.push("work_date <= ?"), args.push(f.to));
    if (f.orgIds?.length) (where.push("org_id IN (?)"), args.push(f.orgIds));
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM bff_worklogs WHERE ${where.join(" AND ")} ORDER BY work_date DESC, id DESC LIMIT 5000`,
      args,
    );
    return rows.map((r) => this.toWorklog(r));
  }
}
