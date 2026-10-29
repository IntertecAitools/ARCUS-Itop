import { AppError, badRequest, notFound } from "../../core/errors.js";
import type { Caller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import { likeContains } from "../../itop/oql.js";
import type { CmdbSchema } from "../../schema/load.js";
import { pageFromEnd, type ObjectsService } from "../objects/objects.service.js";
import {
  PRIORITY_MAP,
  STATUS_MAP,
  toCaseLog,
  type TicketPriority,
  type TicketStatus,
} from "../../shared/ticket-mapping.js";
import { itopFieldsToIso } from "../../shared/itop-time.js";
import { allowedStimuli } from "../../shared/stimulus-rights.js";

/** iTop's profile that widens an end user's view to their organisation. */
export const POWER_USER_PROFILE = "Portal power user";

/** The lifecycle actions iTop's portal offers end users (itop-tickets portal forms). */
const PORTAL_ACTIONS: Record<string, PortalAction> = { ev_close: "close", ev_reopen: "reopen" };
export type PortalAction = "close" | "reopen";

/** The ticket classes an end user deals with, as iTop's portal scope names them. */
const TICKET_CLASSES = ["UserRequest", "Incident"] as const;

const LIST_FIELDS =
  "id,ref,title,status,priority,operational_status,start_date,last_update,service_name,servicesubcategory_name";
/** The resolution target, where the datamodel has one (the ITIL ticket modules). */
const TARGET_FIELDS = ["ttr_escalation_deadline", "sla_ttr_passed"] as const;
const DETAIL_FIELDS =
  `${LIST_FIELDS},description,solution,public_log,urgency,impact,resolution_date,close_date,` +
  "caller_id_friendlyname,agent_id_friendlyname,team_id_friendlyname";

export interface PortalTicket {
  id: number;
  ref: string;
  kind: "request" | "incident";
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  service: string;
  subcategory: string;
  /**
   * When the request should be resolved by: the time-to-resolve deadline
   * iTop computes from the SLA that applies (ISO instant), "" when none does.
   */
  targetDate: string;
  /** The target date passed before the request was resolved. */
  targetMissed: boolean;
}

export interface PortalTicketDetail extends PortalTicket {
  description: string;
  solution: string;
  caller: string;
  agent: string;
  team: string;
  resolvedAt: string;
  closedAt: string;
  urgency: string;
  impact: string;
  satisfaction: string;
  userComment: string;
  log: { date: string; author: string; message: string }[];
  actions: PortalAction[];
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * The self-service portal, for end users ("Portal user" profile).
 *
 * iTop's REST API refuses end-user accounts outright, so these calls run as
 * the BFF's service account -- which makes THIS class the access control.
 * Every query is narrowed by the scopes iTop's own portal declares
 * (datamodels/2.x/itop-tickets/datamodel.itop-tickets.xml):
 *
 *   tickets   caller_id = the user's contact (their organisation, for a
 *             "Portal power user"), UserRequest and Incident only
 *   catalogue services of the user's organisation's customer contracts,
 *             in production
 *
 * and every write first re-reads the ticket inside that scope. Comments are
 * written with case-log `add_item` on behalf of the user (only an
 * administrator account may, core/ormcaselog.class.inc.php:542), so the
 * entry carries their name, not the service account's.
 */
export class PortalService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly objects: ObjectsService,
  ) {}

  /** Which FAQs end users may read; all of them until the knowledge workflow says otherwise. */
  private visibleFaqs: (ids: number[]) => Promise<Set<number>> = async (ids) => new Set(ids);

  /** The knowledge module's rule: only published articles reach the portal. */
  useFaqVisibility(filter: (ids: number[]) => Promise<Set<number>>): void {
    this.visibleFaqs = filter;
  }

  /** The scope condition for this user's tickets. */
  private scope(caller: Caller): string {
    if (caller.contactId <= 0) {
      throw new AppError("forbidden", "Your account is not linked to a person, so it has no requests. Ask an administrator.");
    }
    const who = caller.profiles.includes(POWER_USER_PROFILE) && caller.orgId > 0
      ? `org_id = ${caller.orgId}`
      : `caller_id = ${caller.contactId}`;
    return `finalclass IN ('${TICKET_CLASSES.join("','")}') AND ${who}`;
  }

  private fieldSpec(fields: string): string {
    return TICKET_CLASSES.map((c) => `${c}:${fields}${this.targetFields(c)}`).join(";");
  }

  /** `,ttr_escalation_deadline,...` for a class that has them, else "". */
  private targetFields(cls: string): string {
    const known = this.schema.get(cls)?.fields ?? {};
    return TARGET_FIELDS.filter((f) => known[f]).map((f) => `,${f}`).join("");
  }

  /** A row's fields with its DateTimes and case-log dates as ISO instants. */
  private fieldsOf(row: FlatObject): Record<string, unknown> {
    return itopFieldsToIso(row.fields, this.schema.get(row.class), this.objects.timeZone);
  }

  private toTicket(row: FlatObject): PortalTicket {
    const f = this.fieldsOf(row);
    return {
      id: row.id,
      ref: str(f["ref"]) || `#${row.id}`,
      kind: row.class === "Incident" ? "incident" : "request",
      title: str(f["title"]),
      status: STATUS_MAP[str(f["status"])] ?? "open",
      priority: PRIORITY_MAP[str(f["priority"])] ?? "medium",
      closed: str(f["operational_status"]) === "closed",
      createdAt: str(f["start_date"]),
      updatedAt: str(f["last_update"]),
      service: str(f["service_name"]),
      subcategory: str(f["servicesubcategory_name"]),
      targetDate: str(f["ttr_escalation_deadline"]),
      targetMissed: str(f["sla_ttr_passed"]) === "yes",
    };
  }

  async listTickets(
    caller: Caller,
    query: { closed: boolean; q?: string; page: number; limit: number },
  ): Promise<{ items: PortalTicket[]; total: number; page: number; pages: number }> {
    const conditions = [this.scope(caller), `operational_status ${query.closed ? "=" : "!="} 'closed'`];
    const term = query.q?.trim();
    if (term) conditions.push(`(ref LIKE ${likeContains(term)} OR title LIKE ${likeContains(term)})`);

    // Newest first, whatever the user's volume: one count, then only the
    // requested page read from the end of iTop's order (ref, i.e. filing
    // order). Loading every ticket to sort it here kept the OLDEST 500 for a
    // busy caller and cost one sequential call per 100 tickets.
    const get = async (page: number, limit: number) =>
      this.client.call(
        "core/get",
        {
          class: "Ticket",
          key: `SELECT Ticket WHERE ${conditions.join(" AND ")}`,
          output_fields: this.fieldSpec(LIST_FIELDS),
          limit,
          page,
        },
        { asService: true },
      );
    const total = parseFoundCount((await get(1, 1)).message) ?? 0;
    const rows = await pageFromEnd(total, query.page, query.limit, async (page) =>
      normalizeObjects((await get(page, query.limit)).objects),
    );
    return {
      items: rows.map((r) => this.toTicket(r)),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** One ticket, or 404 when it does not exist OR is outside the user's scope. */
  async getTicket(caller: Caller, id: number): Promise<PortalTicketDetail> {
    const row = await this.loadInScope(caller, id, DETAIL_FIELDS);
    const f = this.fieldsOf(row);
    const lifecycle = this.schema.get(row.class)?.lifecycle;
    // Only what the user's own profiles grant (Portal user: close, reopen).
    const offered = allowedStimuli(this.schema.lineage(row.class), lifecycle?.states[str(f["status"])] ?? [], caller);

    return {
      ...this.toTicket(row),
      description: str(f["description"]),
      solution: str(f["solution"]),
      caller: str(f["caller_id_friendlyname"]),
      agent: str(f["agent_id_friendlyname"]),
      team: str(f["team_id_friendlyname"]),
      resolvedAt: str(f["resolution_date"]),
      closedAt: str(f["close_date"]),
      urgency: str(f["urgency"]),
      impact: str(f["impact"]),
      satisfaction: str(f["user_satisfaction"]),
      userComment: str(f["user_comment"]),
      log: toCaseLog(f["public_log"]),
      actions: offered.flatMap((s) => (PORTAL_ACTIONS[s] ? [PORTAL_ACTIONS[s]!] : [])),
    };
  }

  private async loadInScope(caller: Caller, id: number, fields: string): Promise<FlatObject> {
    const extra = fields.includes("user_satisfaction") ? "" : ",user_satisfaction,user_comment";
    const spec = TICKET_CLASSES.map(
      (c) => `${c}:${fields}${c === "UserRequest" ? extra : ""}${fields === DETAIL_FIELDS ? this.targetFields(c) : ""}`,
    ).join(";");
    const result = await this.client.call(
      "core/get",
      { class: "Ticket", key: `SELECT Ticket WHERE id = ${Number(id)} AND ${this.scope(caller)}`, output_fields: spec },
      { asService: true },
    );
    const row = normalizeObjects(result.objects)[0];
    if (!row) throw notFound(`Request ${id} was not found.`);
    return row;
  }

  /** The services and subcategories this user's organisation is contracted for. */
  async catalog(caller: Caller) {
    if (caller.orgId <= 0) return { services: [] };
    const contract =
      "JOIN lnkCustomerContractToService AS l1 ON l1.service_id=s.id " +
      `JOIN CustomerContract AS cc ON l1.customercontract_id=cc.id WHERE cc.org_id = ${caller.orgId}`;
    const [services, subcategories] = await Promise.all([
      this.client.call(
        "core/get",
        {
          class: "Service",
          key: `SELECT Service AS s ${contract} AND s.status = 'production'`,
          output_fields: "id,name,description,servicefamily_name",
        },
        { asService: true },
      ),
      this.client.call(
        "core/get",
        {
          class: "ServiceSubcategory",
          key: `SELECT ServiceSubcategory AS ssc JOIN Service AS s ON ssc.service_id=s.id ${contract} AND ssc.status = 'production'`,
          output_fields: "id,name,description,service_id",
        },
        { asService: true },
      ),
    ]);
    const subs = normalizeObjects(subcategories.objects);
    return {
      services: normalizeObjects(services.objects)
        .map((s) => ({
          id: s.id,
          name: str(s.fields["name"]),
          description: str(s.fields["description"]),
          family: str(s.fields["servicefamily_name"]),
          subcategories: subs
            .filter((sc) => Number(sc.fields["service_id"]) === s.id)
            .map((sc) => ({ id: sc.id, name: str(sc.fields["name"]), description: str(sc.fields["description"]) })),
        }))
        .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name)),
    };
  }

  /** Raises a request for the signed-in user, in their organisation. */
  async createRequest(
    caller: Caller,
    input: { title: string; description: string; serviceId?: number; subcategoryId?: number; urgency?: string },
  ): Promise<PortalTicketDetail> {
    if (caller.contactId <= 0 || caller.orgId <= 0) {
      throw new AppError("forbidden", "Your account is not linked to a person in an organisation, so it cannot raise requests.");
    }
    if (!input.title.trim() || !input.description.trim()) throw badRequest("A request needs a title and a description.");

    // The service must be one the user's organisation is contracted for.
    if (input.serviceId !== undefined) {
      const { services } = await this.catalog(caller);
      const service = services.find((s) => s.id === input.serviceId);
      if (!service) throw badRequest("That service is not available to you.");
      if (input.subcategoryId !== undefined && !service.subcategories.some((sc) => sc.id === input.subcategoryId)) {
        throw badRequest("That subcategory does not belong to the chosen service.");
      }
    } else if (input.subcategoryId !== undefined) {
      throw badRequest("Choose a service for that subcategory.");
    }

    const fields: Record<string, unknown> = {
      title: input.title.trim(),
      description: input.description.trim(),
      org_id: caller.orgId,
      caller_id: caller.contactId,
      origin: "portal",
      urgency: input.urgency && ["1", "2", "3", "4"].includes(input.urgency) ? input.urgency : "4",
      impact: "3",
      // NOT NULL in the datamodel, recomputed by iTop from impact x urgency.
      priority: "4",
    };
    if (input.serviceId !== undefined) fields["service_id"] = input.serviceId;
    if (input.subcategoryId !== undefined) fields["servicesubcategory_id"] = input.subcategoryId;

    const { object } = await this.objects.create("UserRequest", fields, {
      fields: "id",
      comment: `Raised by ${caller.name} (${caller.login}) in the self-service portal`,
      asService: true,
    });
    return this.getTicket(caller, object.id);
  }

  /** Adds a public comment, authored as the user. */
  async comment(caller: Caller, id: number, message: string): Promise<PortalTicketDetail> {
    if (!message.trim()) throw badRequest("Write a message first.");
    const row = await this.loadInScope(caller, id, "id");
    await this.client.call(
      "core/update",
      {
        class: row.class,
        key: id,
        fields: { public_log: this.entry(caller, message) },
        output_fields: "id",
        comment: `Comment by ${caller.login} in the self-service portal`,
      },
      { asService: true },
    );
    return this.getTicket(caller, id);
  }

  /**
   * Close (confirm a resolution) or reopen, as iTop's portal allows. Close on
   * a request records the user's satisfaction (1-4) and comment, which iTop
   * prompts for in the closed state; reopen requires a message.
   */
  async act(
    caller: Caller,
    id: number,
    action: PortalAction,
    input: { satisfaction?: string; comment?: string; message?: string },
  ): Promise<PortalTicketDetail> {
    const ticket = await this.getTicket(caller, id);
    if (!ticket.actions.includes(action)) {
      throw badRequest(`This ${ticket.kind} cannot be ${action === "close" ? "closed" : "reopened"} now.`);
    }
    const cls = ticket.kind === "incident" ? "Incident" : "UserRequest";
    const fields: Record<string, unknown> = {};
    if (action === "reopen") {
      if (!input.message?.trim()) throw badRequest("Say why the request is being reopened.");
      fields["public_log"] = this.entry(caller, input.message);
    } else if (cls === "UserRequest") {
      if (input.satisfaction) {
        if (!["1", "2", "3", "4"].includes(input.satisfaction)) throw badRequest("Satisfaction is 1 to 4.");
        fields["user_satisfaction"] = input.satisfaction;
      }
      if (input.comment?.trim()) fields["user_comment"] = input.comment.trim();
    }

    await this.client.call(
      "core/apply_stimulus",
      {
        class: cls,
        key: id,
        stimulus: action === "close" ? "ev_close" : "ev_reopen",
        fields,
        output_fields: "id",
        comment: `${action === "close" ? "Closed" : "Reopened"} by ${caller.login} in the self-service portal`,
      },
      { asService: true },
    );
    return this.getTicket(caller, id);
  }

  /** A case-log entry authored as the end user, not the service account. */
  private entry(caller: Caller, message: string) {
    return { add_item: { message: message.trim(), user_id: caller.userId, user_login: caller.name || caller.login } };
  }

  async faqs(q?: string) {
    const term = q?.trim();
    const where = term
      ? ` WHERE title LIKE ${likeContains(term)} OR summary LIKE ${likeContains(term)} OR key_words LIKE ${likeContains(term)}`
      : "";
    const result = await this.client.call(
      "core/get",
      { class: "FAQ", key: `SELECT FAQ${where}`, output_fields: "id,title,summary,category_name", limit: 200 },
      { asService: true },
    );
    const rows = normalizeObjects(result.objects);
    const visible = await this.visibleFaqs(rows.map((r) => r.id));
    return {
      items: rows
        .filter((r) => visible.has(r.id))
        .map((r) => ({ id: r.id, title: str(r.fields["title"]), summary: str(r.fields["summary"]), category: str(r.fields["category_name"]) }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)),
    };
  }

  async faq(id: number) {
    const result = await this.client.call(
      "core/get",
      { class: "FAQ", key: id, output_fields: "id,title,summary,description,category_name" },
      { asService: true },
    );
    const r = normalizeObjects(result.objects)[0];
    if (!r || !(await this.visibleFaqs([r.id])).has(r.id)) throw notFound(`FAQ ${id} was not found.`);
    return {
      id: r.id,
      title: str(r.fields["title"]),
      summary: str(r.fields["summary"]),
      description: str(r.fields["description"]),
      category: str(r.fields["category_name"]),
    };
  }

  /** The user's own person record: what iTop's portal profile brick shows. */
  async profile(caller: Caller) {
    if (caller.contactId <= 0) throw notFound("Your account is not linked to a person.");
    const result = await this.client.call(
      "core/get",
      {
        class: "Person",
        key: caller.contactId,
        output_fields: "id,first_name,name,email,phone,mobile_phone,function,org_id_friendlyname",
      },
      { asService: true },
    );
    const r = normalizeObjects(result.objects)[0];
    if (!r) throw notFound("Your person record was not found.");
    return {
      firstName: str(r.fields["first_name"]),
      lastName: str(r.fields["name"]),
      email: str(r.fields["email"]),
      phone: str(r.fields["phone"]),
      mobilePhone: str(r.fields["mobile_phone"]),
      function: str(r.fields["function"]),
      organization: str(r.fields["org_id_friendlyname"]),
    };
  }

  /** End users may keep their phone numbers current; nothing else. */
  async updateProfile(caller: Caller, input: { phone?: string; mobilePhone?: string }) {
    if (caller.contactId <= 0) throw notFound("Your account is not linked to a person.");
    const fields: Record<string, unknown> = {};
    if (input.phone !== undefined) fields["phone"] = input.phone.trim();
    if (input.mobilePhone !== undefined) fields["mobile_phone"] = input.mobilePhone.trim();
    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");
    await this.objects.update("Person", caller.contactId, fields, {
      fields: "id",
      comment: `Updated by ${caller.login} in the self-service portal`,
      asService: true,
    });
    return this.profile(caller);
  }

  /** The ticket class an attachment call must target, after the scope check. */
  async attachmentHost(caller: Caller, id: number): Promise<string> {
    return (await this.loadInScope(caller, id, "id")).class;
  }
}
