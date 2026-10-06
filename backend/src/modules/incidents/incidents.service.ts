import { notFound } from "../../core/errors.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import {
  isTrue,
  oqlString,
  PRIORITY_TO_ITOP,
  STATUS_TO_ITOP,
  str,
  TICKET_FIELDS,
  toTicket,
} from "../../shared/ticket-mapping.js";
import type { IncidentDetail, IncidentListQuery, IncidentListResult } from "./incidents.types.js";

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
  "resolution_date",
  "close_date",
  "last_update",
  "sla_tto_passed",
  "sla_ttr_passed",
  "tto_escalation_deadline",
  "ttr_escalation_deadline",
  "solution",
].join(",");

/**
 * Incidents — unplanned interruptions to a service.
 *
 * All OQL stops here. Callers pass our vocabulary (`status: "open"`,
 * `priority: "critical"`) and get our DTOs back; iTop's `assigned`,
 * `escalated_ttr` and numeric priorities never cross this boundary.
 */
export class IncidentsService {
  constructor(private readonly objects: ObjectsService) {}

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
      return {
        items: [],
        page: query.page,
        limit: query.limit,
        total: 0,
        pages: 0,
        hasMore: false,
      };
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

    const optional = (key: string) => {
      const value = str(f[key]);
      return value ? value : undefined;
    };

    return {
      ...toTicket(item),
      description: str(f["description"]),
      caller: link("caller_id", "caller_name"),
      organization: link("org_id", "org_name"),
      team: link("team_id", "team_name"),
      service: optional("service_name"),
      serviceSubcategory: optional("servicesubcategory_name"),
      impact: optional("impact"),
      urgency: optional("urgency"),
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
    };
  }
}
