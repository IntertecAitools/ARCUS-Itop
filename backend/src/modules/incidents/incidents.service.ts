import { badRequest, notFound } from "../../core/errors.js";
import type { Mailer } from "../../platform/auth/mailer.js";
import { likeContains } from "../../itop/oql.js";
import type { CmdbSchema } from "../../schema/load.js";
import { assertMayApplyStimulus, mayApplyStimulus } from "../../shared/stimulus-rights.js";
import type { DefaultOrganization } from "../../shared/default-organization.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import {
  actionsForState,
  IMPACT_LABELS,
  IMPACT_MAP,
  isTrue,
  ORIGINS,
  personName,
  PRIORITY_TO_ITOP,
  RESOLUTION_CODES,
  STATUS_TO_ITOP,
  str,
  TICKET_FIELDS,
  toCaseLog,
  OPEN_STATES,
  toTicket,
  TRANSITIONS,
  URGENCY_MAP,
} from "../../shared/ticket-mapping.js";
import type {
  CreateIncidentInput,
  IncidentDetail,
  IncidentListQuery,
  IncidentListResult,
  IncidentOptions,
  IncidentRow,
  LinkedIncident,
  StakeholderUpdateInput,
  StakeholderUpdateResult,
  TransitionInput,
  UpdateIncidentInput,
} from "./incidents.types.js";
import { stakeholderMail } from "./stakeholder-mail.js";
import { extrasMissing, type TicketExtras } from "./ticket-extras.js";

/** Extra fields the detail screen needs on top of a list row. */
const DETAIL_FIELDS = [
  TICKET_FIELDS,
  "description",
  "caller_id",
  "caller_id_friendlyname",
  "org_id",
  "org_name",
  "team_id",
  "team_name",
  "service_name",
  "servicesubcategory_name",
  "impact",
  "urgency",
  "origin",
  "resolution_date",
  "close_date",
  "last_update",
  "sla_tto_passed",
  "sla_ttr_passed",
  "tto_escalation_deadline",
  "ttr_escalation_deadline",
  "solution",
  "resolution_code",
  "public_log",
  "parent_incident_id",
].join(",");

/** A linked incident (parent or child), as the detail screen lists it. */
const LINK_FIELDS = "id,ref,title,status";

/** Most children a major incident lists, posts updates on and notifies. */
const CHILD_CAP = 500;

/** Turns a snake_case enum value into something a human reads. */
const humanise = (value: string) =>
  value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: humanise(value) }));

/**
 * Incidents — unplanned interruptions to a service.
 *
 * All OQL and every iTop stimulus stop here. Callers pass our vocabulary
 * (`status: "open"`, `action: "resolve"`) and get our DTOs back; iTop's
 * `assigned`, `ev_resolve` and numeric priorities never cross this boundary.
 */
/** Incident and its parent, for the stimulus grants (shared/stimulus-rights). */
const INCIDENT_LINEAGE = ["Incident", "Ticket"];

/** Most organisations, teams or services a form lists. */
const FORM_OPTION_CAP = 1000;
/** Most agents a form lists. */
const AGENT_OPTION_CAP = 2000;

export class IncidentsService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly schema: CmdbSchema,
    private readonly defaultOrganization: DefaultOrganization,
    private readonly extras: TicketExtras,
    /** Sends stakeholder updates; absent when no mail server is configured. */
    private readonly mailer?: Mailer,
  ) {}

  /* --------------------------------------------------------------------- *
   * Read
   * --------------------------------------------------------------------- */

  /**
   * Builds the WHERE clause from our filter vocabulary.
   *
   * Returns `null` when a filter is satisfiable by no iTop state at all — the
   * caller then short-circuits to an empty page rather than issuing a query
   * whose WHERE clause would be dropped, which would return everything.
   */
  private buildWhere(query: IncidentListQuery): string | null {
    const clauses: string[] = [];

    if (query.status?.length) {
      const states = [...new Set(query.status.flatMap((s) => STATUS_TO_ITOP[s] ?? []))];
      if (states.length === 0) return null;
      clauses.push(`status IN (${states.map((s) => `'${s}'`).join(",")})`);
    }

    if (query.priority?.length) {
      const values = query.priority.map((p) => PRIORITY_TO_ITOP[p]).filter(Boolean);
      if (values.length === 0) return null;
      clauses.push(`priority IN (${values.map((p) => `'${p}'`).join(",")})`);
    }

    if (query.assignee) {
      // `0` is iTop's "unassigned"; anything else is an agent id.
      const id = query.assignee === "unassigned" ? "0" : query.assignee;
      if (!/^\d+$/.test(id)) return null;
      clauses.push(`agent_id = ${id}`);
    }

    if (query.q) {
      const pattern = likeContains(query.q);
      clauses.push(`(ref LIKE ${pattern} OR title LIKE ${pattern})`);
    }

    if (query.major) clauses.push("major_incident = 'yes'");
    if (query.overdue) clauses.push(this.extras.overdueCondition());

    return clauses.length ? clauses.join(" AND ") : "1=1";
  }

  async list(query: IncidentListQuery): Promise<IncidentListResult> {
    let where = this.buildWhere(query);
    // Without the extension no incident is major or has a next-action date:
    // the honest answer is an empty page, not an OQL error.
    if (where !== null && (query.major || query.overdue) && !(await this.extras.available("Incident"))) {
      where = null;
    }

    if (where === null) {
      return { items: [], page: query.page, limit: query.limit, total: 0, pages: 0, hasMore: false };
    }

    const result = await this.objects.list("Incident", {
      page: query.page,
      limit: query.limit,
      oql: `SELECT Incident WHERE ${where}`,
      fields: TICKET_FIELDS,
      // iTop cannot sort; the objects layer handles it and flags sortedInBff.
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.order ? { order: query.order } : {}),
    });

    const items = result.items.map(toTicket);
    return {
      items: await this.withExtras(items),
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: result.pages,
      hasMore: result.hasMore,
    };
  }

  async get(id: string): Promise<IncidentDetail> {
    const result = await this.objects.list("Incident", {
      page: 1,
      limit: 1,
      oql: `SELECT Incident WHERE id = ${id}`,
      fields: DETAIL_FIELDS,
    });

    const item = result.items[0];
    if (!item) throw notFound(`Incident ${id} was not found.`);

    return this.detail(item);
  }

  /** Rows with their pending reason, next-action date and major flag. */
  private async withExtras<T extends IncidentRow>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const extras = await this.extras.read("Incident", rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, ...extras.get(row.id) }));
  }

  /** The detail DTO, with the extension's fields and the linked incidents. */
  private async detail(item: ObjectDto): Promise<IncidentDetail> {
    const id = String(item.id);
    const parentId = str(item.fields["parent_incident_id"]);
    const [extras, available, children, parents] = await Promise.all([
      this.extras.read("Incident", [id]),
      this.extras.available("Incident"),
      this.linked(`parent_incident_id = ${Number(id)}`),
      parentId && parentId !== "0" ? this.linked(`id = ${Number(parentId)}`) : Promise.resolve([]),
    ]);
    return {
      ...this.toDetail(item),
      ...extras.get(id),
      ...(parents[0] ? { parentIncident: parents[0] } : {}),
      childIncidents: children,
      extrasAvailable: available,
    };
  }

  private async linked(where: string): Promise<LinkedIncident[]> {
    const result = await this.objects.listAll(
      "Incident",
      { oql: `SELECT Incident WHERE ${where}`, fields: LINK_FIELDS },
      CHILD_CAP,
    );
    return result.items.map((row) => {
      const ticket = toTicket(row);
      return { id: ticket.id, ref: ticket.ref, summary: ticket.summary, status: ticket.status };
    });
  }

  private toDetail(item: ObjectDto): Omit<IncidentDetail, "childIncidents" | "extrasAvailable"> {
    const f = item.fields;

    /** Builds a {id,name} only when iTop actually holds a link (0 = none). */
    const link = (idKey: string, nameKey: string) => {
      const id = str(f[idKey]);
      return id && id !== "0" ? { id, name: str(f[nameKey]) } : undefined;
    };

    const optional = (key: string) => str(f[key]) || undefined;

    const rawStatus = str(f["status"]);
    const lifecycle = this.schema.get("Incident")?.lifecycle ?? null;

    return {
      ...toTicket(item),
      description: str(f["description"]),
      caller: (() => {
        const id = str(f["caller_id"]);
        return id && id !== "0" ? { id, name: personName(f, "caller") } : undefined;
      })(),
      organization: link("org_id", "org_name"),
      team: link("team_id", "team_name"),
      service: optional("service_name"),
      serviceSubcategory: optional("servicesubcategory_name"),
      impact: IMPACT_MAP[str(f["impact"])] ?? optional("impact"),
      urgency: URGENCY_MAP[str(f["urgency"])] ?? optional("urgency"),
      origin: optional("origin"),
      resolvedAt: optional("resolution_date"),
      closedAt: optional("close_date"),
      lastUpdatedAt: optional("last_update"),
      sla: {
        ttoBreached: isTrue(f["sla_tto_passed"]),
        ttrBreached: isTrue(f["sla_ttr_passed"]),
        ttoDeadline: optional("tto_escalation_deadline"),
        ttrDeadline: optional("ttr_escalation_deadline"),
      },
      resolution: optional("solution"),
      resolutionCode: optional("resolution_code"),
      log: toCaseLog(f["public_log"]),
      // Only the actions the caller's profiles grant, so the buttons match.
      availableActions: actionsForState(rawStatus, lifecycle).filter((action) =>
        mayApplyStimulus(INCIDENT_LINEAGE, TRANSITIONS[action].stimulus),
      ),
    };
  }

  /* --------------------------------------------------------------------- *
   * Write
   * --------------------------------------------------------------------- */

  async create(input: CreateIncidentInput): Promise<IncidentDetail> {
    // The reporter is not asked which company they work for; in a helpdesk
    // that is noise. The server resolves it -- see DefaultOrganization.
    const organizationId = input.organizationId ?? (await this.defaultOrganization.resolve());

    const fields: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      org_id: Number(organizationId),
      urgency: input.urgency ?? "3",
      impact: input.impact ?? "2",
      // iTop is contradictory here: `priority` is flagged NOT NULL, so create
      // fails without it — yet iTop immediately recomputes it from
      // urgency x impact and discards whatever was sent. So this is a
      // placeholder that satisfies the constraint, not a value with meaning.
      // That is also why `priority` is not part of CreateIncidentInput: it
      // would be an input that silently does nothing.
      priority: "3",
    };

    if (input.callerId) fields["caller_id"] = Number(input.callerId);
    if (input.origin) fields["origin"] = input.origin;
    if (input.serviceId) fields["service_id"] = Number(input.serviceId);
    if (input.serviceSubcategoryId) {
      fields["servicesubcategory_id"] = Number(input.serviceSubcategoryId);
    }
    if (input.agentId) fields["agent_id"] = Number(input.agentId);
    if (input.teamId) fields["team_id"] = Number(input.teamId);
    // An ISO instant or iTop's own wall-clock text; write validation puts
    // either on iTop's clock with the seconds it insists on.
    if (input.startDate) fields["start_date"] = input.startDate;

    const { object } = await this.objects.create("Incident", fields, {
      fields: DETAIL_FIELDS,
      comment: "Incident created via ARCUS",
    });

    return this.detail(object);
  }

  async update(id: string, input: UpdateIncidentInput): Promise<IncidentDetail> {
    const fields: Record<string, unknown> = {};

    if (input.title !== undefined) fields["title"] = input.title;
    if (input.description !== undefined) fields["description"] = input.description;
    if (input.urgency !== undefined) fields["urgency"] = input.urgency;
    if (input.impact !== undefined) fields["impact"] = input.impact;

    // `null` means "clear the link", which iTop expresses as 0. Leaving the
    // key out entirely means "don't touch it" — the two must stay distinct.
    const link = (value: string | null | undefined, key: string) => {
      if (value === undefined) return;
      fields[key] = value === null || value === "" ? 0 : Number(value);
    };
    link(input.agentId, "agent_id");
    link(input.teamId, "team_id");
    link(input.serviceId, "service_id");
    link(input.serviceSubcategoryId, "servicesubcategory_id");

    if (Object.keys(fields).length === 0) {
      throw badRequest("No changes were supplied.");
    }

    const { object } = await this.objects.update("Incident", Number(id), fields, {
      fields: DETAIL_FIELDS,
      comment: "Incident updated via ARCUS",
    });

    return this.detail(object);
  }

  /**
   * Applies a lifecycle action.
   *
   * The action is checked against iTop's own lifecycle for the CURRENT state
   * before being sent, so an illegal transition fails as a clear 400 here
   * rather than a generic upstream error.
   */
  async transition(id: string, input: TransitionInput): Promise<IncidentDetail> {
    const current = await this.get(id);
    // A 403 naming the profile it needs, rather than "not available".
    assertMayApplyStimulus(INCIDENT_LINEAGE, TRANSITIONS[input.action].stimulus, "incident");

    if (!current.availableActions.includes(input.action)) {
      throw badRequest(
        `"${input.action}" is not available for an incident that is ${current.status}. ` +
          `Available: ${current.availableActions.join(", ") || "none"}.`,
      );
    }

    if (input.action === "hold") {
      // The next-action date lives in the extension, which the generic
      // stimulus path cannot write: TicketExtras applies the hold.
      if (!input.pendingReason?.trim()) throw badRequest('"hold" requires a pending reason.');
      if (!input.nextActionDate) throw badRequest('"hold" requires a next-action date.');
      await this.extras.hold("Incident", id, {
        reason: input.pendingReason,
        nextActionDate: input.nextActionDate,
        ...(input.comment ? { comment: input.comment } : {}),
      });
      return this.get(id);
    }

    const transition = TRANSITIONS[input.action];
    const fields: Record<string, unknown> = {};

    if (input.agentId) fields["agent_id"] = Number(input.agentId);
    if (input.solution) fields["solution"] = input.solution;
    if (input.resolutionCode) fields["resolution_code"] = input.resolutionCode;
    if (input.comment) fields["public_log"] = input.comment;

    for (const required of transition.requires) {
      if (fields[required] === undefined) {
        throw badRequest(`"${input.action}" requires ${required}.`);
      }
    }

    const object = await this.objects.applyStimulus(
      "Incident",
      Number(id),
      transition.stimulus,
      fields,
      { fields: DETAIL_FIELDS, comment: `${transition.label} via ARCUS` },
    );

    return this.detail(object);
  }

  /** Appends a message to the public case log. */
  async addLogEntry(id: string, message: string): Promise<IncidentDetail> {
    const { object } = await this.objects.update(
      "Incident",
      Number(id),
      { public_log: message },
      { fields: DETAIL_FIELDS, comment: "Comment added via ARCUS" },
    );
    return this.detail(object);
  }

  /* --------------------------------------------------------------------- *
   * Major incidents
   * --------------------------------------------------------------------- */

  /** Declares the incident a major incident, or clears the flag. */
  async setMajor(id: string, major: boolean): Promise<IncidentDetail> {
    await this.get(id);
    await this.extras.setMajor(id, major);
    return this.get(id);
  }

  /**
   * Links incidents to this one as its children (iTop's own
   * parent_incident_id). An incident already linked elsewhere moves here.
   */
  async linkChildren(id: string, childIds: string[]): Promise<IncidentDetail> {
    const parent = await this.get(id);
    const ids = [...new Set(childIds)];
    if (ids.length === 0) throw badRequest("Name at least one incident to link.");
    if (ids.includes(id)) throw badRequest("An incident cannot be linked to itself.");
    if (parent.parentIncident && ids.includes(parent.parentIncident.id)) {
      throw badRequest(`${parent.parentIncident.ref} is the parent of ${parent.ref}, so it cannot also be its child.`);
    }
    const found = await this.linked(`id IN (${ids.map(Number).join(",")})`);
    const missing = ids.filter((child) => !found.some((row) => row.id === child));
    if (missing.length) throw notFound(`Incident ${missing.join(", ")} was not found.`);

    for (const child of ids) {
      await this.objects.update("Incident", Number(child), { parent_incident_id: Number(id) }, {
        fields: "id",
        comment: `Linked to ${parent.ref} via ARCUS`,
      });
    }
    return this.get(id);
  }

  /** Unlinks a child incident from this one. */
  async unlinkChild(id: string, childId: string): Promise<IncidentDetail> {
    const parent = await this.get(id);
    if (!parent.childIncidents.some((child) => child.id === childId)) {
      throw notFound(`Incident ${childId} is not linked to ${parent.ref}.`);
    }
    await this.objects.update("Incident", Number(childId), { parent_incident_id: 0 }, {
      fields: "id",
      comment: `Unlinked from ${parent.ref} via ARCUS`,
    });
    return this.get(id);
  }

  /**
   * A stakeholder update: posted on the incident's public log, optionally on
   * every open child's too, and optionally emailed to the callers and any
   * further addresses. The subject carries the ref in brackets, so a reply
   * lands back on the incident through the support mailbox.
   */
  async postStakeholderUpdate(id: string, input: StakeholderUpdateInput): Promise<StakeholderUpdateResult> {
    const before = await this.get(id);
    const message = input.message.trim();
    if (!message) throw badRequest("A message is required.");
    if (!before.extrasAvailable) throw extrasMissing();
    if (!before.major) throw badRequest(`${before.ref} is not a major incident; declare it one first.`);

    const entry = `Stakeholder update: ${message}`;
    await this.objects.update("Incident", Number(id), { public_log: entry }, {
      fields: "id",
      comment: "Stakeholder update via ARCUS",
    });

    const children = before.childIncidents.filter((child) => child.status !== "closed");
    let postedTo = 0;
    if (input.postToChildren) {
      for (const child of children) {
        await this.objects.update("Incident", Number(child.id), { public_log: `${before.ref} ${entry}` }, {
          fields: "id",
          comment: `Stakeholder update from ${before.ref} via ARCUS`,
        });
        postedTo += 1;
      }
    }

    const recipients = new Set(
      (input.notifyEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean),
    );
    if (input.notifyCallers) {
      for (const email of await this.callerEmails([id, ...children.map((child) => child.id)])) {
        recipients.add(email.toLowerCase());
      }
    }

    const notified: string[] = [];
    let notifyError: string | undefined;
    if (recipients.size > 0) {
      if (!this.mailer) {
        notifyError = "No mail server is configured (SMTP_HOST), so no email was sent.";
      } else {
        const mail = stakeholderMail(before.ref, before.summary, message);
        // One message per address: callers of different customers must not
        // see each other's addresses.
        for (const to of recipients) {
          try {
            await this.mailer.send({ to, ...mail });
            notified.push(to);
          } catch (error) {
            notifyError = `Sending to ${to} failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }
    }

    return {
      incident: await this.get(id),
      postedTo,
      notified,
      ...(notifyError ? { notifyError } : {}),
    };
  }

  /** The email addresses of the callers of these incidents. */
  private async callerEmails(ids: string[]): Promise<string[]> {
    const result = await this.objects.listAll(
      "Incident",
      { oql: `SELECT Incident WHERE id IN (${ids.map(Number).join(",")})`, fields: "caller_id" },
      CHILD_CAP + 1,
    );
    const callers = [
      ...new Set(result.items.map((row) => str(row.fields["caller_id"])).filter((c) => c && c !== "0")),
    ];
    if (callers.length === 0) return [];
    const people = await this.objects.listAll(
      "Person",
      { oql: `SELECT Person WHERE id IN (${callers.map(Number).join(",")})`, fields: "email" },
      CHILD_CAP + 1,
    );
    return people.items.map((row) => str(row.fields["email"])).filter((email) => email.includes("@"));
  }

  /** Open major incidents, newest first: the dashboard's banner. */
  async openMajor(): Promise<IncidentRow[]> {
    if (!(await this.extras.available("Incident"))) return [];
    const result = await this.objects.list("Incident", {
      page: 1,
      limit: 20,
      oql: `SELECT Incident WHERE major_incident = 'yes' AND status IN (${OPEN_STATES})`,
      fields: TICKET_FIELDS,
    });
    const rows = result.items.map(toTicket).sort((a, b) => Number(b.id) - Number(a.id));
    return (await this.withExtras(rows)).map((row) => ({ ...row, major: true }));
  }

  /* --------------------------------------------------------------------- *
   * Form options
   * --------------------------------------------------------------------- */

  /**
   * Everything a create/edit form needs, in ONE request.
   *
   * The alternative is five round trips before a form can render, and iTop is
   * roughly half a second per call.
   */
  async formOptions(): Promise<IncidentOptions> {
    // Whole lists, not the first 200: at 2,000 people a 200-row cap left most
    // agents unpickable. Paged in parallel by listAll.
    const pick = async (className: string, oql = `SELECT ${className}`, cap = FORM_OPTION_CAP) => {
      const label = "friendlyname";
      try {
        const result = await this.objects.listAll(className, { oql, fields: `id,${label}` }, cap);
        return result.items.map((item) => ({
          value: String(item.id),
          label: str(item.fields[label]) || item.label || `#${item.id}`,
        }));
      } catch {
        // A class the instance does not have must not take the whole form
        // down — the picker simply renders empty.
        return [];
      }
    };

    const [organizations, agents, teams, services] = await Promise.all([
      pick("Organization"),
      // iTop accepts as agent only a member of the ticket's team, so the
      // agents are the people in a team -- not every caller in the instance.
      pick("Person", "SELECT Person AS p JOIN lnkPersonToTeam AS l ON l.person_id = p.id", AGENT_OPTION_CAP),
      pick("Team"),
      pick("Service"),
    ]);

    // Subcategories carry their parent service id so the form can narrow the
    // second picker to the first choice, instead of listing every subcategory
    // in the instance and letting the user pick an impossible pair.
    let serviceSubcategories: Array<{ value: string; label: string; serviceId: string }> = [];
    try {
      const result = await this.objects.list("ServiceSubcategory", {
        page: 1,
        limit: 500,
        oql: "SELECT ServiceSubcategory",
        fields: "id,name,service_id",
      });
      serviceSubcategories = result.items.map((item) => ({
        value: String(item.id),
        label: str(item.fields["name"]) || item.label || `#${item.id}`,
        serviceId: str(item.fields["service_id"]),
      }));
    } catch {
      serviceSubcategories = [];
    }

    return {
      priorities: [
        { value: "critical", label: "Critical" },
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      urgencies: Object.entries(URGENCY_MAP).map(([value, label]) => ({
        value,
        label: humanise(label),
      })),
      // iTop's own wording rather than a humanised code: impact is a scope,
      // and "Department" on its own reads like a field name.
      impacts: Object.entries(IMPACT_MAP).map(([value, label]) => ({
        value,
        label: IMPACT_LABELS[label] ?? humanise(label),
      })),
      origins: options(ORIGINS),
      resolutionCodes: options(RESOLUTION_CODES),
      organizations,
      agents,
      teams,
      services,
      serviceSubcategories,
    };
  }
}
