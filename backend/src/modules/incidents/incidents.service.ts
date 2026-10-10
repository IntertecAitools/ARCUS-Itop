import { badRequest, notFound } from "../../core/errors.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { DefaultOrganization } from "../../shared/default-organization.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import {
  actionsForState,
  IMPACT_MAP,
  isTrue,
  ORIGINS,
  oqlString,
  PRIORITY_TO_ITOP,
  RESOLUTION_CODES,
  STATUS_TO_ITOP,
  str,
  TICKET_FIELDS,
  toCaseLog,
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
  TransitionInput,
  UpdateIncidentInput,
} from "./incidents.types.js";

/** Extra fields the detail screen needs on top of a list row. */
const DETAIL_FIELDS = [
  TICKET_FIELDS,
  "description",
  "caller_id",
  "caller_name",
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
].join(",");

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
export class IncidentsService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly schema: CmdbSchema,
    private readonly defaultOrganization: DefaultOrganization,
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
      const term = oqlString(query.q);
      clauses.push(`(ref LIKE '%${term}%' OR title LIKE '%${term}%')`);
    }

    return clauses.length ? clauses.join(" AND ") : "1=1";
  }

  async list(query: IncidentListQuery): Promise<IncidentListResult> {
    const where = this.buildWhere(query);

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

    return {
      items: result.items.map(toTicket),
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

    return this.toDetail(item);
  }

  private toDetail(item: ObjectDto): IncidentDetail {
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
      caller: link("caller_id", "caller_name"),
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
      availableActions: actionsForState(rawStatus, lifecycle),
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
    if (input.startDate) {
      // datetime-local gives "YYYY-MM-DDTHH:mm"; iTop wants a space and seconds.
      const value = input.startDate.replace("T", " ");
      fields["start_date"] = value.length === 16 ? `${value}:00` : value;
    }

    const { object } = await this.objects.create("Incident", fields, {
      fields: DETAIL_FIELDS,
      comment: "Incident created via ARCUS",
    });

    return this.toDetail(object);
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

    return this.toDetail(object);
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

    if (!current.availableActions.includes(input.action)) {
      throw badRequest(
        `"${input.action}" is not available for an incident that is ${current.status}. ` +
          `Available: ${current.availableActions.join(", ") || "none"}.`,
      );
    }

    const transition = TRANSITIONS[input.action];
    const fields: Record<string, unknown> = {};

    if (input.agentId) fields["agent_id"] = Number(input.agentId);
    if (input.solution) fields["solution"] = input.solution;
    if (input.resolutionCode) fields["resolution_code"] = input.resolutionCode;
    if (input.pendingReason) fields["pending_reason"] = input.pendingReason;
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

    return this.toDetail(object);
  }

  /** Appends a message to the public case log. */
  async addLogEntry(id: string, message: string): Promise<IncidentDetail> {
    const { object } = await this.objects.update(
      "Incident",
      Number(id),
      { public_log: message },
      { fields: DETAIL_FIELDS, comment: "Comment added via ARCUS" },
    );
    return this.toDetail(object);
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
    const pick = async (className: string, label = "friendlyname") => {
      try {
        const result = await this.objects.list(className, {
          page: 1,
          limit: 200,
          oql: `SELECT ${className}`,
          fields: `id,${label}`,
        });
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
      pick("Person"),
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
      impacts: Object.entries(IMPACT_MAP).map(([value, label]) => ({
        value,
        label: humanise(label),
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
