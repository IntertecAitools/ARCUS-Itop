import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant, runAsServiceAccount } from "../../core/request-context.js";
import type { ItopClient, Logger } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { Mailer } from "../../platform/auth/mailer.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import type { CurrentContact } from "../../shared/current-contact.js";
import { isTrue, PRIORITY_MAP, str } from "../../shared/ticket-mapping.js";
import { completeRules, matchRule, NO_RULES, type AssignmentRuleStore } from "./assignment-rules.js";
import { dispatchMail } from "./dispatch-mail.js";
import type {
  AssignmentRules,
  AssignmentRulesDto,
  RoutingFacts,
  RuleTestResult,
  TakenTicket,
  TeamQueue,
  TeamQueueItem,
  TicketType,
} from "./dispatch.types.js";

/**
 * Team dispatch: a ticket sent to a team with nobody in it chosen yet, the
 * team's queue, "Take it", and the assignment rules that dispatch a new
 * ticket by itself.
 *
 * The Dispatched state and ev_dispatch come from the arcus-ticket-dispatch
 * iTop extension (itop-extensions/arcus-ticket-dispatch). Without it the
 * rules route nothing, the queue is empty and ev_dispatch is refused here
 * with a 409 saying what to install.
 */

const CLASS_OF: Record<TicketType, "Incident" | "UserRequest"> = { incident: "Incident", request: "UserRequest" };
const TYPE_OF: Record<string, TicketType> = { Incident: "incident", UserRequest: "request" };

/** The states a ticket waits in a team's queue: dispatched, or TTO ran out while it was. */
const WAITING = ["dispatched", "escalated_tto"];

/** Most queued tickets read per class. */
const QUEUE_CAP = 500;
/** Most team members a dispatch email goes to. */
const MAIL_CAP = 100;

/** How long a "the extension is missing" answer is trusted before asking iTop again. */
const MISSING_RECHECK_MS = 60_000;

export const dispatchMissing = () =>
  new AppError(
    "conflict",
    "This iTop cannot dispatch tickets to a team: install the arcus-ticket-dispatch extension " +
      '(backend/README.md, "Team dispatch and assignment rules").',
    { details: { reason: "extension_missing" } },
  );

const idOrUndefined = (value: unknown) => {
  const id = str(value);
  return id && id !== "0" ? id : undefined;
};

export class DispatchService {
  /** true, or the time a check found the extension missing. */
  private known: true | number | undefined;

  constructor(
    private readonly client: ItopClient,
    private readonly objects: ObjectsService,
    private readonly store: AssignmentRuleStore,
    private readonly currentContact: CurrentContact,
    /** The frontend's address, for the links in dispatch emails. */
    private readonly appBaseUrl: string,
    /** Absent when no mail server is configured. */
    private readonly mailer?: Mailer,
    private readonly logger?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Whether this iTop has the extension: its `dispatch_date` attribute. An
   * OQL naming an attribute the class lacks is refused, so one cheap call
   * answers. A "yes" is kept; a "no" is asked again after a minute.
   */
  async available(): Promise<boolean> {
    if (this.known === true) return true;
    if (typeof this.known === "number" && this.now() - this.known < MISSING_RECHECK_MS) return false;
    const result = await this.client.callRaw(
      "core/get",
      { class: "Incident", key: "SELECT Incident WHERE id = 0 AND dispatch_date > '2000-01-01'", output_fields: "id" },
      { asService: true },
    );
    this.known = result.code === 0 ? true : this.now();
    return this.known === true;
  }

  /* --------------------------------------------------------------------- *
   * Rules
   * --------------------------------------------------------------------- */

  private tenantKey(): string {
    return currentTenant()?.id ?? "";
  }

  private async rules(): Promise<AssignmentRules> {
    const stored = await this.store.get(this.tenantKey());
    return stored ? completeRules(stored.rules) : structuredClone(NO_RULES);
  }

  async getRules(): Promise<AssignmentRulesDto> {
    const [stored, available] = await Promise.all([this.store.get(this.tenantKey()), this.available()]);
    return {
      ...(stored ? completeRules(stored.rules) : structuredClone(NO_RULES)),
      available,
      mailConfigured: this.mailer !== undefined,
      updatedAt: stored?.updatedAt ?? "",
      updatedBy: stored?.updatedBy ?? "",
    };
  }

  async saveRules(input: AssignmentRules): Promise<AssignmentRulesDto> {
    const ids = new Set<string>();
    for (const rule of input.rules) {
      if (ids.has(rule.id)) throw badRequest(`Two rules share the id "${rule.id}".`);
      ids.add(rule.id);
    }
    await this.store.save(this.tenantKey(), completeRules(input), currentCaller()?.login ?? "");
    return this.getRules();
  }

  /** Which rule would route a ticket with these facts. */
  async test(facts: RoutingFacts): Promise<RuleTestResult> {
    const rule = matchRule((await this.rules()).rules, facts);
    return rule ? { rule } : {};
  }

  /* --------------------------------------------------------------------- *
   * Routing a new ticket (ObjectsService create listener)
   * --------------------------------------------------------------------- */

  /**
   * Dispatches a ticket just made to the team of the first matching rule.
   * A ticket nothing matches stays New, for the service desk. So does one
   * its creator already gave a team or an agent: that was their call.
   *
   * The rule acts, not the person who raised the ticket (often an end user,
   * whom iTop refuses), so ev_dispatch goes out as the service account and
   * no stimulus grant is asked. Never throws: the ticket is made either way.
   */
  async route(className: string, created: ObjectDto): Promise<boolean> {
    const type = TYPE_OF[className];
    if (!type) return false;
    try {
      const doc = await this.rules();
      if (!doc.rules.some((r) => r.enabled)) return false;
      if (!(await this.available())) return false;

      const result = await this.client.call(
        "core/get",
        {
          class: className,
          key: created.id,
          output_fields: "status,org_id,service_id,servicesubcategory_id,team_id,agent_id",
        },
        { asService: true },
      );
      const f = normalizeObjects(result.objects)[0]?.fields;
      if (!f || str(f["status"]) !== "new" || idOrUndefined(f["team_id"]) || idOrUndefined(f["agent_id"])) {
        return false;
      }
      const rule = matchRule(doc.rules, {
        ticketType: type,
        organizationId: idOrUndefined(f["org_id"]),
        serviceId: idOrUndefined(f["service_id"]),
        serviceSubcategoryId: idOrUndefined(f["servicesubcategory_id"]),
      });
      if (!rule) return false;

      const dispatched = await runAsServiceAccount(() =>
        this.client.call("core/apply_stimulus", {
          class: className,
          key: created.id,
          stimulus: "ev_dispatch",
          fields: { team_id: Number(rule.teamId) },
          output_fields: "id,ref,title,team_id,team_name",
          comment: `Dispatched by the assignment rule "${rule.name}" via ARCUS`,
        }),
      );
      const row = normalizeObjects(dispatched.objects)[0];
      if (row && doc.notifyTeam) await this.notifyTeam(className, row.id, row.fields);
      return true;
    } catch (error) {
      this.logger?.warn({ err: error, class: className, id: created.id }, "assignment rules could not route a new ticket");
      return false;
    }
  }

  /* --------------------------------------------------------------------- *
   * Dispatch by hand (ObjectsService guard and stimulus listener)
   * --------------------------------------------------------------------- */

  /** Refuses ev_dispatch on an iTop without the extension, before iTop's own generic error. */
  async guard(className: string, stimulus: string): Promise<void> {
    if (stimulus !== "ev_dispatch" || !TYPE_OF[className]) return;
    if (!(await this.available())) throw dispatchMissing();
  }

  /** Emails the team once a ticket was dispatched to it by hand, when the rules say so. */
  async afterStimulus(className: string, object: ObjectDto, stimulus: string): Promise<void> {
    if (stimulus !== "ev_dispatch" || !TYPE_OF[className]) return;
    try {
      if (!(await this.rules()).notifyTeam) return;
      await this.notifyTeam(className, object.id);
    } catch (error) {
      this.logger?.warn({ err: error, class: className, id: object.id }, "the dispatch email could not be sent");
    }
  }

  /**
   * One email per address: the team's own address when it has one, else
   * each member's. Read as the service account (people's addresses).
   */
  private async notifyTeam(className: string, id: number, known?: Record<string, unknown>): Promise<void> {
    if (!this.mailer) return;
    const mailer = this.mailer;
    await runAsServiceAccount(async () => {
      const f =
        known && "ref" in known && "team_id" in known
          ? known
          : normalizeObjects(
              (
                await this.client.call("core/get", {
                  class: className,
                  key: id,
                  output_fields: "ref,title,team_id,team_name",
                })
              ).objects,
            )[0]?.fields;
      const teamId = idOrUndefined(f?.["team_id"]);
      if (!f || !teamId) return;

      const team = normalizeObjects(
        (await this.client.call("core/get", { class: "Team", key: Number(teamId), output_fields: "name,email" })).objects,
      )[0]?.fields;
      let to = [str(team?.["email"])].filter((email) => email.includes("@"));
      if (to.length === 0) {
        const members = await this.client.call("core/get", {
          class: "Person",
          key: `SELECT Person AS p JOIN lnkPersonToTeam AS l ON l.person_id = p.id WHERE l.team_id = ${Number(teamId)}`,
          output_fields: "email",
          limit: MAIL_CAP,
          page: 1,
        });
        to = normalizeObjects(members.objects).map((p) => str(p.fields["email"])).filter((email) => email.includes("@"));
      }

      const type = TYPE_OF[className]!;
      const mail = dispatchMail({
        ref: str(f["ref"]),
        title: str(f["title"]),
        team: str(team?.["name"]) || str(f["team_name"]),
        ticketUrl: `${this.appBaseUrl}${type === "incident" ? `/incidents/${id}` : `/records/UserRequest/${id}`}`,
        queueUrl: `${this.appBaseUrl}/team-queue`,
      });
      for (const address of new Set(to.map((email) => email.toLowerCase()))) {
        await mailer.send({ to: address, ...mail });
      }
    });
  }

  /* --------------------------------------------------------------------- *
   * The team's queue, and "Take it"
   * --------------------------------------------------------------------- */

  /** The teams the signed-in person belongs to. */
  private async myTeams(contactId: string): Promise<Array<{ id: string; name: string }>> {
    const result = await this.client.call("core/get", {
      class: "Team",
      key: `SELECT Team AS t JOIN lnkPersonToTeam AS l ON l.team_id = t.id WHERE l.person_id = ${Number(contactId)}`,
      output_fields: "friendlyname",
    });
    return normalizeObjects(result.objects)
      .map((row) => ({ id: String(row.id), name: str(row.fields["friendlyname"]) || `#${row.id}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Tickets dispatched to the caller's teams that nobody has taken, oldest dispatch first. */
  async queue(): Promise<TeamQueue> {
    const contactId = await this.currentContact.resolve();
    const [teams, available] = await Promise.all([this.myTeams(contactId), this.available()]);
    if (!available || teams.length === 0) return { teams, items: [], available, truncated: false };

    const teamIds = teams.map((t) => Number(t.id)).join(",");
    let truncated = false;
    const perClass = await Promise.all(
      (["incident", "request"] as const).map(async (type) => {
        const className = CLASS_OF[type];
        const result = await this.client.call("core/get", {
          class: className,
          key:
            `SELECT ${className} WHERE team_id IN (${teamIds}) AND agent_id = 0 ` +
            `AND status IN (${WAITING.map((s) => `'${s}'`).join(",")})`,
          output_fields:
            "ref,title,status,priority,team_id,team_name,org_name,service_name,start_date,dispatch_date,tto_escalation_deadline,sla_tto_passed",
          limit: QUEUE_CAP + 1,
          page: 1,
        });
        const rows = normalizeObjects(result.objects);
        if (rows.length > QUEUE_CAP) truncated = true;
        return rows.slice(0, QUEUE_CAP).map((row) => this.toQueueItem(type, row.id, row.fields));
      }),
    );

    const items = perClass.flat().sort((a, b) =>
      (a.dispatchedAt || a.createdAt).localeCompare(b.dispatchedAt || b.createdAt),
    );
    return { teams, items, available, truncated };
  }

  private toQueueItem(type: TicketType, id: number, f: Record<string, unknown>): TeamQueueItem {
    const optional = (key: string) => str(f[key]) || undefined;
    const organization = optional("org_name");
    const service = optional("service_name");
    const dispatchedAt = optional("dispatch_date");
    const ttoDeadline = optional("tto_escalation_deadline");
    return {
      type,
      id: String(id),
      ref: str(f["ref"]) || `#${id}`,
      summary: str(f["title"]),
      priority: PRIORITY_MAP[str(f["priority"])] ?? "medium",
      team: { id: str(f["team_id"]), name: str(f["team_name"]) },
      ...(organization ? { organization } : {}),
      ...(service ? { service } : {}),
      createdAt: str(f["start_date"]),
      ...(dispatchedAt ? { dispatchedAt } : {}),
      ...(ttoDeadline ? { ttoDeadline } : {}),
      escalated: str(f["status"]) === "escalated_tto" || isTrue(f["sla_tto_passed"]),
    };
  }

  /**
   * "Take it": assigns a ticket waiting in a team's queue to the caller,
   * with iTop's own ev_assign. Only a member of that team may take it, and
   * only while nobody has.
   */
  async take(type: TicketType, id: string): Promise<TakenTicket> {
    const className = CLASS_OF[type];
    const contactId = await this.currentContact.resolve();
    const result = await this.client.call("core/get", {
      class: className,
      key: Number(id),
      output_fields: "ref,status,team_id,team_name,agent_id,agent_id_friendlyname",
    });
    const f = normalizeObjects(result.objects)[0]?.fields;
    if (!f) throw notFound(`${type === "incident" ? "Incident" : "Request"} ${id} was not found.`);
    const ref = str(f["ref"]) || `#${id}`;

    if (idOrUndefined(f["agent_id"])) {
      const who = str(f["agent_id_friendlyname"]).trim();
      throw new AppError("conflict", `${ref} has already been taken${who ? ` by ${who}` : ""}.`, {
        details: { reason: "already_taken" },
      });
    }
    const teamId = idOrUndefined(f["team_id"]);
    if (!teamId || !WAITING.includes(str(f["status"]))) {
      throw badRequest(`${ref} is not waiting in a team's queue.`);
    }

    const membership = await this.client.call("core/get", {
      class: "lnkPersonToTeam",
      key: `SELECT lnkPersonToTeam WHERE team_id = ${Number(teamId)} AND person_id = ${Number(contactId)}`,
      output_fields: "id",
    });
    if (normalizeObjects(membership.objects).length === 0) {
      throw new AppError("forbidden", `Only a member of ${str(f["team_name"]) || "its team"} can take ${ref}.`, {
        details: { reason: "not_in_team" },
      });
    }

    // Rights (ev_assign) and the guards are checked there, as for Assign.
    await this.objects.applyStimulus(className, Number(id), "ev_assign", { agent_id: Number(contactId) }, {
      fields: "id",
      comment: "Taken from the team queue via ARCUS",
    });
    return { type, id, ref };
  }
}
