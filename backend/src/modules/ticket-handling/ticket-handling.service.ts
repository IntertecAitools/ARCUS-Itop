import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant, type Caller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { likeContains } from "../../itop/oql.js";
import { addDays, itopDay, itopValueToIso } from "../../shared/itop-time.js";
import { assertMayApplyStimulus, mayApplyStimulus } from "../../shared/stimulus-rights.js";
import {
  PRIORITY_MAP,
  PRIORITY_TO_ITOP,
  STATUS_MAP,
  str,
  type TicketPriority,
} from "../../shared/ticket-mapping.js";
import { computePriority, inputsFor } from "./priority.js";
import { titleSimilarity, titleWords } from "./similarity.js";
import type { StoredWorklog, TicketHandlingStore } from "./ticket-handling.store.js";
import type {
  AgentTotal,
  CancelInfo,
  DuplicateCandidate,
  DuplicateQuery,
  HandledClass,
  MarkDuplicateInput,
  PriorityOverride,
  PriorityOverrideInput,
  TicketHandling,
  TicketRef,
  TicketWorklog,
  WorklogEntry,
  WorklogInput,
  WorklogReport,
  WorklogReportQuery,
} from "./ticket-handling.types.js";

/** iTop states that are over: nothing more can be done to the ticket. */
const DONE_STATES = ["resolved", "closed", "rejected"];
const DONE_OQL = `status NOT IN ('${DONE_STATES.join("','")}')`;

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Words the solution starts with, which is how a duplicate or a cancellation is recognised later. */
export const DUPLICATE_PREFIX = "Duplicate of ";
export const CANCEL_PREFIX = "Cancelled by ";

const what = (cls: HandledClass) => (cls === "Incident" ? "incident" : "user request");
const lineage = (cls: HandledClass) => [cls, "Ticket"];

/** iTop's HTML text as one plain line: tags dropped, the common entities decoded. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** "Cancelled by Ann Lee: no longer needed" → who and why. */
export function parseCancelled(solution: string): CancelInfo | undefined {
  const text = plainText(solution);
  if (!text.startsWith(CANCEL_PREFIX)) return undefined;
  const rest = text.slice(CANCEL_PREFIX.length);
  const colon = rest.indexOf(": ");
  return colon < 0 ? { by: rest, reason: "" } : { by: rest.slice(0, colon), reason: rest.slice(colon + 2) };
}

/** The ref a "Duplicate of I-000123…" solution names. */
export function parseDuplicateRef(solution: string): string | undefined {
  const text = plainText(solution);
  if (!text.startsWith(DUPLICATE_PREFIX)) return undefined;
  return /^[^\s:.,]+/.exec(text.slice(DUPLICATE_PREFIX.length))?.[0];
}

/**
 * Which parent field links a duplicate to its original. iTop has
 * `parent_incident_id` on both ticket classes and `parent_request_id` on
 * UserRequest only, so an incident cannot point at a request.
 */
export function parentField(duplicate: HandledClass, original: HandledClass): string | undefined {
  if (original === "Incident") return "parent_incident_id";
  return duplicate === "UserRequest" ? "parent_request_id" : undefined;
}

function caller(): Caller | undefined {
  return currentCaller();
}

const callerName = (c: Caller | undefined) => c?.name || c?.login || "the service desk";

/**
 * Priority override, duplicates, cancel and worklogs on incidents and user
 * requests. Everything is written to iTop through the tenant-scoped client
 * as the signed-in user (or, for a requester cancelling from the portal, as
 * the service account after PortalService has checked the ticket is theirs),
 * so iTop's own rights apply on top of the stimulus grants checked here.
 */
export class TicketHandlingService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: TicketHandlingStore,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private tenant(): string {
    return currentTenant()?.id ?? "";
  }

  private today(): string {
    return itopDay(this.now(), this.timeZone);
  }

  private async read(cls: HandledClass, id: number, fields: string, asService = false): Promise<FlatObject> {
    const result = await this.client.call(
      "core/get",
      { class: cls, key: `SELECT ${cls} WHERE id = ${Number(id)}`, output_fields: fields },
      { asService },
    );
    const row = normalizeObjects(result.objects)[0];
    if (!row) throw notFound(`${cls === "Incident" ? "Incident" : "Request"} ${id} was not found.`);
    return row;
  }

  private toRef(cls: HandledClass, row: FlatObject): TicketRef {
    return {
      class: cls,
      id: row.id,
      ref: str(row.fields["ref"]) || `#${row.id}`,
      title: str(row.fields["title"]),
      status: STATUS_MAP[str(row.fields["status"])] ?? "open",
    };
  }

  private parentFields(cls: HandledClass): string[] {
    return cls === "UserRequest" ? ["parent_request_id", "parent_incident_id"] : ["parent_incident_id"];
  }

  /* ---------------------------------------------------------------- summary */

  async summary(cls: HandledClass, id: number): Promise<TicketHandling> {
    const fields = ["ref", "title", "status", "priority", "impact", "urgency", "solution", ...this.parentFields(cls)];
    const row = await this.read(cls, id, fields.join(","));
    const f = row.fields;
    const status = str(f["status"]);
    const open = !DONE_STATES.includes(status);
    const ref = str(f["ref"]) || `#${id}`;
    const solution = str(f["solution"]);

    const stored = await this.store.latestOverride(this.tenant(), cls, id);
    const override: PriorityOverride | undefined = stored
      ? {
          from: stored.from,
          to: stored.to,
          reason: stored.reason,
          by: stored.by,
          at: stored.at,
          impactFrom: stored.impactFrom,
          urgencyFrom: stored.urgencyFrom,
          impactTo: stored.impactTo,
          urgencyTo: stored.urgencyTo,
          active: str(f["impact"]) === stored.impactTo && str(f["urgency"]) === stored.urgencyTo,
        }
      : undefined;

    let duplicateOf: TicketRef | undefined;
    if (!open && parseDuplicateRef(solution)) {
      for (const field of this.parentFields(cls)) {
        const parentId = Number(f[field] ?? 0);
        if (parentId > 0) {
          const parentCls: HandledClass = field === "parent_request_id" ? "UserRequest" : "Incident";
          duplicateOf = await this.read(parentCls, parentId, "ref,title,status")
            .then((p) => this.toRef(parentCls, p))
            .catch(() => undefined);
          if (duplicateOf) break;
        }
      }
    }

    const cancelled = !open ? parseCancelled(solution) : undefined;
    const entries = await this.store.listWorklogs({ tenant: this.tenant(), class: cls, ticketId: id });
    const c = caller();
    const staff = c === undefined || c.kind === "staff";
    const mayResolve = mayApplyStimulus(lineage(cls), "ev_resolve");

    return {
      class: cls,
      id,
      ref,
      open,
      priority: PRIORITY_MAP[str(f["priority"])] ?? "medium",
      ...(override ? { override } : {}),
      ...(duplicateOf ? { duplicateOf } : {}),
      duplicates: await this.duplicatesOf(cls, id, ref),
      ...(cancelled ? { cancelled } : {}),
      can: {
        overridePriority: staff && open,
        markDuplicate: staff && open && mayResolve,
        cancel: staff && open && mayResolve && mayApplyStimulus(lineage(cls), "ev_close"),
        logTime: staff,
      },
      worklog: { totalMinutes: entries.reduce((n, e) => n + e.minutes, 0), entries: entries.length },
    };
  }

  /** Tickets resolved as duplicates of this one. */
  private async duplicatesOf(cls: HandledClass, id: number, ref: string): Promise<TicketRef[]> {
    const marker = `solution LIKE ${likeContains(`${DUPLICATE_PREFIX}${ref}`)}`;
    const queries: [HandledClass, string][] =
      cls === "Incident"
        ? [
            ["Incident", `SELECT Incident WHERE parent_incident_id = ${id} AND ${marker}`],
            ["UserRequest", `SELECT UserRequest WHERE parent_incident_id = ${id} AND ${marker}`],
          ]
        : [["UserRequest", `SELECT UserRequest WHERE parent_request_id = ${id} AND ${marker}`]];
    const out: TicketRef[] = [];
    for (const [c, key] of queries) {
      const result = await this.client.call("core/get", { class: c, key, output_fields: "ref,title,status" });
      out.push(...normalizeObjects(result.objects).map((r) => this.toRef(c, r)));
    }
    return out;
  }

  /* -------------------------------------------------------- priority override */

  async overridePriority(cls: HandledClass, id: number, input: PriorityOverrideInput): Promise<TicketHandling> {
    const reason = input.reason.trim();
    if (reason.length < 3) throw badRequest("Say why the priority is overridden.", { field: "reason" });
    const row = await this.read(cls, id, "ref,status,priority,impact,urgency");
    const f = row.fields;
    if (DONE_STATES.includes(str(f["status"]))) {
      throw badRequest(`This ${what(cls)} is ${str(f["status"])}; its priority can no longer change.`);
    }
    const from = PRIORITY_MAP[str(f["priority"])] ?? "medium";
    if (from === input.priority) throw badRequest(`The priority is already ${PRIORITY_LABEL[from]}.`, { field: "priority" });

    const current = { impact: Number(f["impact"]) || 3, urgency: Number(f["urgency"]) || 4 };
    const target = Number(PRIORITY_TO_ITOP[input.priority]);
    const pair = inputsFor(target, current);
    if (!pair) throw badRequest("iTop's priority matrix has no impact and urgency giving that priority.");

    const c = caller();
    const changed = [
      pair.impact !== current.impact ? `impact ${current.impact} → ${pair.impact}` : "",
      pair.urgency !== current.urgency ? `urgency ${current.urgency} → ${pair.urgency}` : "",
    ].filter(Boolean);
    const note =
      `Priority overridden from ${PRIORITY_LABEL[from]} to ${PRIORITY_LABEL[input.priority]} by ${callerName(c)}: ${reason}` +
      ` (${changed.join(", ")}, so iTop computes the new priority)`;

    const result = await this.client.call("core/update", {
      class: cls,
      key: id,
      fields: { impact: String(pair.impact), urgency: String(pair.urgency), private_log: note },
      output_fields: "priority,impact,urgency",
      comment: `Priority override via ARCUS: ${reason}`,
    });
    const written = normalizeObjects(result.objects)[0]?.fields ?? {};
    if (str(written["priority"]) !== String(target)) {
      // A datamodel whose matrix differs from iTop's standard one.
      throw new AppError(
        "conflict",
        `iTop computed priority ${str(written["priority"]) || "?"} instead of ${target}; the override did not take.`,
      );
    }
    await this.store.saveOverride({
      tenant: this.tenant(),
      class: cls,
      ticketId: id,
      from,
      to: input.priority,
      reason,
      by: callerName(c),
      at: this.now().toISOString(),
      impactFrom: String(current.impact),
      urgencyFrom: String(current.urgency),
      impactTo: String(pair.impact),
      urgencyTo: String(pair.urgency),
    });
    return this.summary(cls, id);
  }

  /* ------------------------------------------------------------- duplicates */

  async markDuplicate(cls: HandledClass, id: number, input: MarkDuplicateInput): Promise<TicketHandling> {
    if (input.originalClass === cls && input.originalId === id) {
      throw badRequest("A ticket cannot be a duplicate of itself.");
    }
    const field = parentField(cls, input.originalClass);
    if (!field) {
      throw badRequest("An incident can only be a duplicate of another incident (iTop has no request parent on incidents).");
    }
    assertMayApplyStimulus(lineage(cls), "ev_resolve", what(cls));

    const row = await this.read(cls, id, "ref,status");
    if (DONE_STATES.includes(str(row.fields["status"]))) {
      throw badRequest(`This ${what(cls)} is already ${str(row.fields["status"])}.`);
    }
    const original = await this.read(
      input.originalClass,
      input.originalId,
      ["ref", "title", "status", "solution", ...this.parentFields(input.originalClass)].join(","),
    );
    const of = original.fields;
    const originalRef = str(of["ref"]) || `#${input.originalId}`;
    if (str(of["status"]) === "closed" && parseCancelled(str(of["solution"]))) {
      throw badRequest(`${originalRef} was cancelled; it cannot be the original.`);
    }
    const itsOriginal = parseDuplicateRef(str(of["solution"]));
    if (itsOriginal) {
      throw badRequest(`${originalRef} is itself a duplicate of ${itsOriginal}: mark this one as a duplicate of ${itsOriginal}.`);
    }

    const c = caller();
    const note = input.note?.trim();
    const solution = `${DUPLICATE_PREFIX}${originalRef}${note ? `: ${note}` : "."}`;
    const ref = str(row.fields["ref"]) || `#${id}`;
    await this.client.call("core/apply_stimulus", {
      class: cls,
      key: id,
      // iTop's own "resolved from a parent ticket" transition, which every
      // open state has (new, dispatched, assigned, pending, …); ev_resolve
      // exists only once the ticket is assigned.
      stimulus: "ev_autoresolve",
      fields: {
        [field]: input.originalId,
        solution,
        resolution_code: "other",
        private_log: `Marked as a duplicate of ${originalRef} by ${callerName(c)}${note ? `: ${note}` : "."}`,
      },
      output_fields: "id",
      comment: `Duplicate of ${originalRef} via ARCUS`,
    });
    // A line on the original too, so its handler sees the duplicate arrive.
    // Best effort: the user may read the original without being allowed to write it.
    await this.client
      .call("core/update", {
        class: input.originalClass,
        key: input.originalId,
        fields: { private_log: `${ref} was marked as a duplicate of this ${what(input.originalClass)} by ${callerName(c)}.` },
        output_fields: "id",
        comment: `Duplicate ${ref} linked via ARCUS`,
      })
      .catch(() => undefined);
    return this.summary(cls, id);
  }

  /** Likely duplicates of a ticket being created (no id yet) or triaged. */
  async suggestDuplicates(query: DuplicateQuery): Promise<DuplicateCandidate[]> {
    const title = query.title.trim();
    const words = [...titleWords(title)].sort((a, b) => b.length - a.length).slice(0, 5);
    const ciIds = (query.ciIds ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);

    // Tickets touching the same CIs, by ticket id.
    const ciTickets = new Set<number>();
    if (ciIds.length > 0) {
      const result = await this.client.call("core/get", {
        class: "lnkFunctionalCIToTicket",
        key: `SELECT lnkFunctionalCIToTicket WHERE functionalci_id IN (${ciIds.join(",")})`,
        output_fields: "ticket_id",
        limit: 500,
      });
      for (const r of normalizeObjects(result.objects)) ciTickets.add(Number(r.fields["ticket_id"]));
    }

    const any: string[] = [];
    if (query.callerId) any.push(`caller_id = ${Number(query.callerId)}`);
    if (query.serviceId) any.push(`service_id = ${Number(query.serviceId)}`);
    if (ciTickets.size > 0) any.push(`id IN (${[...ciTickets].slice(0, 500).join(",")})`);
    for (const w of words) any.push(`title LIKE ${likeContains(w)}`);
    if (any.length === 0) return [];

    const classes: HandledClass[] = query.class === "Incident" ? ["Incident"] : ["UserRequest", "Incident"];
    const candidates: DuplicateCandidate[] = [];
    for (const cls of classes) {
      const where = [DONE_OQL, `(${any.join(" OR ")})`];
      if (query.orgId) where.push(`org_id = ${Number(query.orgId)}`);
      if (query.excludeId && cls === query.class) where.push(`id != ${Number(query.excludeId)}`);
      const result = await this.client.call("core/get", {
        class: cls,
        key: `SELECT ${cls} WHERE ${where.join(" AND ")}`,
        output_fields: "ref,title,status,caller_id,caller_id_friendlyname,service_id,start_date",
        limit: 200,
      });
      for (const row of normalizeObjects(result.objects)) {
        const f = row.fields;
        const similarity = titleSimilarity(title, str(f["title"]));
        const sameCaller = !!query.callerId && Number(f["caller_id"]) === query.callerId;
        const sameService = !!query.serviceId && Number(f["service_id"]) === query.serviceId;
        const sameCi = ciTickets.has(row.id);
        const score = Math.min(1, 0.6 * similarity + (sameCaller ? 0.2 : 0) + (sameCi ? 0.2 : 0) + (sameService ? 0.1 : 0));
        if (score < 0.25) continue;
        const reasons = [
          sameCaller ? "same caller" : "",
          sameCi ? "same CI" : "",
          sameService ? "same service" : "",
          similarity >= 0.2 ? "similar title" : "",
        ].filter(Boolean);
        candidates.push({
          ...this.toRef(cls, row),
          caller: str(f["caller_id_friendlyname"]),
          createdAt: str(itopValueToIso(f["start_date"], this.timeZone)),
          score: Math.round(score * 100) / 100,
          reasons,
        });
      }
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /** Suggestions for an existing ticket, from its own caller, service, CIs and title. */
  async suggestFor(cls: HandledClass, id: number): Promise<DuplicateCandidate[]> {
    const row = await this.read(cls, id, "title,org_id,caller_id,service_id");
    const links = await this.client.call("core/get", {
      class: "lnkFunctionalCIToTicket",
      key: `SELECT lnkFunctionalCIToTicket WHERE ticket_id = ${id}`,
      output_fields: "functionalci_id",
    });
    const f = row.fields;
    return this.suggestDuplicates({
      class: cls,
      title: str(f["title"]),
      excludeId: id,
      ...(Number(f["org_id"]) > 0 ? { orgId: Number(f["org_id"]) } : {}),
      ...(Number(f["caller_id"]) > 0 ? { callerId: Number(f["caller_id"]) } : {}),
      ...(Number(f["service_id"]) > 0 ? { serviceId: Number(f["service_id"]) } : {}),
      ciIds: normalizeObjects(links.objects).map((l) => Number(l.fields["functionalci_id"])),
    });
  }

  /* ----------------------------------------------------------------- cancel */

  /**
   * Cancels an open ticket: iTop has no cancelled state, so it is resolved
   * (ev_autoresolve, available in every open state) with resolution code
   * "other" and a solution that starts "Cancelled by …: reason", then closed.
   *
   * Staff need what resolving and closing need (ev_resolve and ev_close).
   * A requester comes through the portal, which has checked the ticket is
   * theirs and that they may close it; the writes then run as the service
   * account, as every portal write does.
   */
  async cancel(cls: HandledClass, id: number, reasonText: string, requester?: Caller): Promise<void> {
    const reason = reasonText.trim();
    if (reason.length < 3) throw badRequest("Say why the ticket is cancelled.", { field: "reason" });
    if (!requester) {
      assertMayApplyStimulus(lineage(cls), "ev_resolve", what(cls));
      assertMayApplyStimulus(lineage(cls), "ev_close", what(cls));
    }
    const asService = requester !== undefined;
    const row = await this.read(cls, id, "status", asService);
    const status = str(row.fields["status"]);
    if (DONE_STATES.includes(status)) throw badRequest(`This ${what(cls)} is already ${status}.`);

    const by = requester ? `${callerName(requester)} (requester)` : callerName(caller());
    const where = requester ? "in the self-service portal" : "via ARCUS";
    await this.client.call(
      "core/apply_stimulus",
      {
        class: cls,
        key: id,
        stimulus: "ev_autoresolve",
        fields: {
          solution: `${CANCEL_PREFIX}${by}: ${reason}`,
          resolution_code: "other",
          private_log: `Cancelled by ${by} ${where}: ${reason}`,
        },
        output_fields: "id",
        comment: `Cancelled ${where}`,
      },
      { asService },
    );
    await this.client.call(
      "core/apply_stimulus",
      { class: cls, key: id, stimulus: "ev_close", fields: {}, output_fields: "id", comment: `Cancelled ${where}` },
      { asService },
    );
  }

  /* --------------------------------------------------------------- worklogs */

  private orgScope(): number[] | undefined {
    const tenantOrgs = currentTenant()?.orgIds ?? [];
    const own = caller()?.allowedOrgIds ?? [];
    if (tenantOrgs.length && own.length) {
      const both = own.filter((o) => tenantOrgs.includes(o));
      return both.length ? both : [-1];
    }
    const scope = tenantOrgs.length ? tenantOrgs : own;
    return scope.length ? scope : undefined;
  }

  private present(entry: StoredWorklog): WorklogEntry {
    const c = caller();
    const { tenant: _tenant, orgId: _orgId, ...rest } = entry;
    return { ...rest, mine: !c || c.isAdmin || c.userId === entry.agent.userId };
  }

  private static totals(entries: { agent: WorklogEntry["agent"]; minutes: number }[]): AgentTotal[] {
    const by = new Map<number, AgentTotal>();
    for (const e of entries) {
      const t = by.get(e.agent.userId) ?? { userId: e.agent.userId, name: e.agent.name, minutes: 0, entries: 0 };
      t.minutes += e.minutes;
      t.entries += 1;
      by.set(e.agent.userId, t);
    }
    return [...by.values()].sort((a, b) => b.minutes - a.minutes);
  }

  async worklog(cls: HandledClass, id: number): Promise<TicketWorklog> {
    await this.read(cls, id, "id"); // may the caller see the ticket at all
    const entries = await this.store.listWorklogs({ tenant: this.tenant(), class: cls, ticketId: id });
    return {
      entries: entries.map((e) => this.present(e)),
      totalMinutes: entries.reduce((n, e) => n + e.minutes, 0),
      byAgent: TicketHandlingService.totals(entries),
    };
  }

  async logTime(cls: HandledClass, id: number, input: WorklogInput): Promise<TicketWorklog> {
    const c = caller();
    if (c && c.kind !== "staff") throw new AppError("forbidden", "Only staff log time.");
    const note = input.note.trim();
    if (!note) throw badRequest("Say what was done.", { field: "note" });
    if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 24 * 60) {
      throw badRequest("Time spent is 1 minute to 24 hours per entry.", { field: "minutes" });
    }
    const today = this.today();
    const workDate = input.workDate ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`))) {
      throw badRequest("The day must be YYYY-MM-DD.", { field: "workDate" });
    }
    if (workDate > today) throw badRequest("Time cannot be logged for a day in the future.", { field: "workDate" });
    if (workDate < addDays(today, -366)) throw badRequest("That day is more than a year ago.", { field: "workDate" });

    const row = await this.read(cls, id, "ref,org_id");
    await this.store.addWorklog({
      tenant: this.tenant(),
      class: cls,
      ticketId: id,
      ticketRef: str(row.fields["ref"]) || `#${id}`,
      orgId: Number(row.fields["org_id"]) || 0,
      agent: { userId: c?.userId ?? 0, contactId: c?.contactId ?? 0, name: callerName(c) },
      minutes: input.minutes,
      note,
      workDate,
    });
    return this.worklog(cls, id);
  }

  async deleteTime(entryId: number): Promise<TicketWorklog> {
    const entry = await this.store.getWorklog(this.tenant(), entryId);
    if (!entry) throw notFound(`Worklog entry ${entryId} was not found.`);
    await this.read(entry.class, entry.ticketId, "id");
    const c = caller();
    if (c && !c.isAdmin && c.userId !== entry.agent.userId) {
      throw new AppError("forbidden", "Only the person who logged the time, or an administrator, can remove it.");
    }
    await this.store.deleteWorklog(this.tenant(), entryId);
    return this.worklog(entry.class, entry.ticketId);
  }

  /** Time logged in a period, per agent and per ticket. Defaults to the last 30 days. */
  async report(query: WorklogReportQuery): Promise<WorklogReport> {
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -29);
    if (from > to) throw badRequest("The period starts after it ends.");
    const orgIds = this.orgScope();
    const entries = await this.store.listWorklogs({
      tenant: this.tenant(),
      from,
      to,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(orgIds ? { orgIds } : {}),
    });
    const byTicket = new Map<string, WorklogReport["byTicket"][number]>();
    for (const e of entries) {
      const key = `${e.class}:${e.ticketId}`;
      const t = byTicket.get(key) ?? { class: e.class, ticketId: e.ticketId, ticketRef: e.ticketRef, minutes: 0, entries: 0 };
      t.minutes += e.minutes;
      t.entries += 1;
      byTicket.set(key, t);
    }
    return {
      from,
      to,
      totalMinutes: entries.reduce((n, e) => n + e.minutes, 0),
      byAgent: TicketHandlingService.totals(entries),
      byTicket: [...byTicket.values()].sort((a, b) => b.minutes - a.minutes),
    };
  }
}

export { computePriority };
