import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { isoToItopTime, itopTimeToIso, toItopTime } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import {
  completeRules,
  DEFAULT_PLAN_RULES,
  listPlans,
  missingPlans,
  PLAN_KINDS,
  type PlanRuleStore,
} from "./plan-rules.js";
import type {
  CabDecision,
  CabDecisionInput,
  CabDecisionValue,
  CabQueue,
  CabQueueItem,
  ChangeGovernance,
  ChangePlans,
  ChangeStatus,
  ChangeType,
  PlanGate,
  PlanKind,
  PlanRules,
  PlanRulesDto,
} from "./changes.types.js";

/** iTop's change classes, and which of our types each is. */
const TYPE_OF_CLASS: Record<string, ChangeType> = {
  RoutineChange: "routine",
  NormalChange: "normal",
  EmergencyChange: "emergency",
};

const TYPE_CLASS: Record<ChangeType, string> = {
  routine: "RoutineChange",
  normal: "NormalChange",
  emergency: "EmergencyChange",
};

/** Every class a change can be addressed as on /api/objects. */
const CHANGE_CLASSES = new Set(["Change", "ApprovedChange", ...Object.keys(TYPE_OF_CLASS)]);

const TYPE_LABEL: Record<ChangeType, string> = { routine: "routine", normal: "normal", emergency: "emergency" };

const STATUS: Record<string, ChangeStatus> = {
  new: "new",
  validated: "validated",
  rejected: "rejected",
  assigned: "assigned",
  plannedscheduled: "planned",
  approved: "approved",
  notapproved: "not_approved",
  implemented: "implemented",
  monitored: "monitored",
  closed: "closed",
};

/** iTop stimulus -> the gate whose plans it needs. ev_replan plans again. */
const GATE_OF_STIMULUS: Record<string, PlanGate> = {
  ev_plan: "plan",
  ev_replan: "plan",
  ev_implement: "implement",
};

/** The CAB's answers, as the change's lifecycle takes them. */
const CAB_STIMULI = new Set(["ev_approve", "ev_notapprove"]);

/**
 * Where each plan lives on Change. `fallback` is iTop's own; the other two
 * come from the arcus-change-cab extension and, like the problem RCA fields,
 * are not in the published schema: this service alone reads and writes them.
 */
const PLAN_FIELDS: Record<PlanKind, string> = {
  implementation: "implementation_plan",
  rollback: "fallback",
  test: "test_plan",
};

/** Plans only the extension provides. */
const EXTENSION_PLANS: PlanKind[] = ["implementation", "test"];

const CHANGE_FIELDS = [
  "ref",
  "title",
  "status",
  "org_name",
  "start_date",
  "end_date",
  "outage",
  "impact",
  ...Object.values(PLAN_FIELDS),
].join(",");

const DECISION_FIELDS = "change_id,meeting_date,attendees,decision,conditions,notes,recorded_by_name,recorded_at";

/** iTop's approval_comment and reason are VARCHAR(255). */
const SHORT_TEXT = 255;

/** Changes the CAB queue reads at most. */
const QUEUE_CAP = 500;

export const APPROVER_PROFILE = "Change Approver";

const extensionMissing = () =>
  new AppError(
    "conflict",
    "This iTop has no implementation or test plans or CAB decisions on changes: install the " +
      "arcus-change-cab extension (backend/README.md, \"Changes\").",
    { details: { reason: "extension_missing" } },
  );

interface ChangeRow {
  id: number;
  type: ChangeType;
  status: string;
  fields: Record<string, unknown>;
  available: boolean;
}

const clip = (text: string, max = SHORT_TEXT) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** True for the extension's "Unknown attribute"/"Unknown class" answers. */
const isUnknownToItop = (error: unknown) =>
  error instanceof AppError && /Unknown (attribute|class)|ChangeCabDecision/i.test(error.message);

/**
 * Change management on top of the generic record screens: which plans a
 * change type must have before it is planned or implemented (rules an
 * administrator edits), the Change Advisory Board's decisions and the
 * changes waiting for one. The change record, its form and its other
 * actions stay with the records module; ObjectsService asks `guardTransition`
 * before applying any action, so the rules hold there too.
 */
export class ChangesService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: PlanRuleStore,
    private readonly timeZone: string,
  ) {}

  /* --------------------------------------------------------------------- *
   * Reading a change
   * --------------------------------------------------------------------- */

  /**
   * The change, as whichever class it really is. Read as `Change` so any
   * id works; iTop answers with the final class. iTop leaves an attribute it
   * does not have out of the answer, which is how a missing extension shows.
   */
  private async change(id: number): Promise<ChangeRow> {
    const result = await this.client.call("core/get", {
      class: "Change",
      key: id,
      output_fields: CHANGE_FIELDS,
    });
    const row = normalizeObjects(result.objects)[0];
    if (!row) throw notFound(`Change ${id} was not found.`);
    return this.toRow(row);
  }

  private toRow(row: FlatObject): ChangeRow {
    const type = TYPE_OF_CLASS[row.class];
    if (!type) throw badRequest(`${row.class} is not a routine, normal or emergency change.`);
    return {
      id: row.id,
      type,
      status: str(row.fields["status"]),
      fields: row.fields,
      available: PLAN_FIELDS.implementation in row.fields,
    };
  }

  private plansOf(change: ChangeRow): ChangePlans {
    const f = change.fields;
    return {
      implementation: str(f[PLAN_FIELDS.implementation]),
      rollback: str(f[PLAN_FIELDS.rollback]),
      test: str(f[PLAN_FIELDS.test]),
    };
  }

  private async decisions(changeIds: number[]): Promise<Map<number, CabDecision[]>> {
    const byChange = new Map<number, CabDecision[]>();
    if (changeIds.length === 0) return byChange;
    const result = await this.client.call("core/get", {
      class: "ChangeCabDecision",
      key: `SELECT ChangeCabDecision WHERE change_id IN (${changeIds.join(",")})`,
      output_fields: DECISION_FIELDS,
    });
    for (const row of normalizeObjects(result.objects)) {
      const changeId = Number(row.fields["change_id"]);
      const list = byChange.get(changeId) ?? [];
      list.push(this.toDecision(row));
      byChange.set(changeId, list);
    }
    // Newest meeting first; same meeting, the later record first.
    for (const list of byChange.values()) {
      list.sort((a, b) => b.meetingDate.localeCompare(a.meetingDate) || Number(b.id) - Number(a.id));
    }
    return byChange;
  }

  private toDecision(row: FlatObject): CabDecision {
    const f = row.fields;
    const decision = str(f["decision"]);
    return {
      id: String(row.id),
      meetingDate: this.iso(f["meeting_date"]),
      attendees: str(f["attendees"])
        .split(/\r?\n/)
        .map((a) => a.trim())
        .filter(Boolean),
      decision: (["approved", "rejected", "deferred"].includes(decision) ? decision : "deferred") as CabDecisionValue,
      conditions: str(f["conditions"]),
      notes: str(f["notes"]),
      recordedBy: str(f["recorded_by_name"]),
      recordedAt: this.iso(f["recorded_at"]),
    };
  }

  private iso(value: unknown): string {
    const text = str(value);
    return text ? itopTimeToIso(text, this.timeZone) : "";
  }

  /* --------------------------------------------------------------------- *
   * Rules
   * --------------------------------------------------------------------- */

  private tenantKey(): string {
    return currentTenant()?.id ?? "";
  }

  async getRules(): Promise<PlanRulesDto> {
    const stored = await this.store.get(this.tenantKey());
    return {
      rules: stored ? completeRules(stored.rules) : structuredClone(DEFAULT_PLAN_RULES),
      defaults: structuredClone(DEFAULT_PLAN_RULES),
      updatedAt: stored?.updatedAt ?? "",
      updatedBy: stored?.updatedBy ?? "",
    };
  }

  async saveRules(rules: PlanRules): Promise<PlanRulesDto> {
    await this.store.save(this.tenantKey(), completeRules(rules), currentCaller()?.login ?? "");
    return this.getRules();
  }

  /* --------------------------------------------------------------------- *
   * Who may do what
   * --------------------------------------------------------------------- */

  /** Without sign-in (development) the BFF acts as its own administrator. */
  private canDecide(): boolean {
    const caller = currentCaller();
    return !caller || caller.isAdmin || caller.profiles.includes(APPROVER_PROFILE);
  }

  /* --------------------------------------------------------------------- *
   * The change's governance: plans, rules, CAB
   * --------------------------------------------------------------------- */

  async governance(id: number): Promise<ChangeGovernance> {
    const [change, rules] = await Promise.all([this.change(id), this.getRules()]);
    const decisions = change.available ? ((await this.decisions([change.id])).get(change.id) ?? []) : [];
    return this.toGovernance(change, rules.rules, decisions);
  }

  private toGovernance(change: ChangeRow, rules: PlanRules, decisions: CabDecision[]): ChangeGovernance {
    const plans = this.plansOf(change);
    const rule = rules[change.type];
    const required = change.type !== "routine";
    const awaiting = required && change.status === "plannedscheduled";
    return {
      changeId: String(change.id),
      ref: str(change.fields["ref"]),
      title: str(change.fields["title"]),
      type: change.type,
      status: STATUS[change.status] ?? "new",
      available: change.available,
      plans,
      requirements: { ...rule },
      missing: {
        plan: this.missing(change, rules, plans, "plan"),
        implement: this.missing(change, rules, plans, "implement"),
      },
      cab: {
        required,
        awaiting,
        canDecide: awaiting && change.available && this.canDecide(),
        decisions,
      },
    };
  }

  /** On an iTop without the extension only the rollback plan can be asked for. */
  private missing(change: ChangeRow, rules: PlanRules, plans: ChangePlans, gate: PlanGate): PlanKind[] {
    const missing = missingPlans(rules[change.type], plans, gate);
    return change.available ? missing : missing.filter((k) => !EXTENSION_PLANS.includes(k));
  }

  /** Writes the changed plans only. */
  async savePlans(id: number, input: Partial<ChangePlans>): Promise<ChangeGovernance> {
    const change = await this.change(id);
    const current = this.plansOf(change);
    const fields: Record<string, string> = {};
    for (const kind of PLAN_KINDS) {
      const value = input[kind];
      if (value === undefined) continue;
      if (value.trim() === current[kind].trim()) continue;
      if (!change.available && EXTENSION_PLANS.includes(kind)) throw extensionMissing();
      fields[PLAN_FIELDS[kind]] = value.trim();
    }
    if (Object.keys(fields).length > 0) {
      try {
        await this.client.call("core/update", {
          class: "Change",
          key: id,
          fields,
          comment: "Change plans updated via ARCUS",
          output_fields: "id",
        });
      } catch (error) {
        if (isUnknownToItop(error)) throw extensionMissing();
        throw error;
      }
    }
    return this.governance(id);
  }

  /* --------------------------------------------------------------------- *
   * The lifecycle guard
   * --------------------------------------------------------------------- */

  /**
   * Called by ObjectsService before it applies an action on any class.
   * Planning and implementing need the plans this change type's rule asks
   * for (a rollback plan given with the action itself counts). Approving or
   * not approving a normal or emergency change is the CAB's decision: it is
   * recorded through `decide`, which applies the action, never directly.
   */
  async guardTransition(
    className: string,
    id: number,
    stimulus: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    if (!CHANGE_CLASSES.has(className)) return;
    const gate = GATE_OF_STIMULUS[stimulus];
    if (!gate && !CAB_STIMULI.has(stimulus)) return;

    const change = await this.change(id);
    if (CAB_STIMULI.has(stimulus)) {
      if (change.type === "routine") return;
      throw new AppError(
        "conflict",
        `A ${TYPE_LABEL[change.type]} change is approved or not approved by recording the CAB decision on it ` +
          "(the CAB tab), so the meeting, attendees and conditions are kept.",
        { details: { reason: "cab_decision_required" } },
      );
    }

    const plans = this.plansOf(change);
    const given = fields[PLAN_FIELDS.rollback];
    if (typeof given === "string") plans.rollback = given;
    const missing = this.missing(change, (await this.getRules()).rules, plans, gate!);
    if (missing.length === 0) return;
    throw new AppError(
      "conflict",
      `Add the ${listPlans(missing)} before ${gate === "plan" ? "planning" : "implementing"} this ` +
        `${TYPE_LABEL[change.type]} change (the CAB & plans tab).`,
      { details: { reason: "plans_missing", gate, missing } },
    );
  }

  /* --------------------------------------------------------------------- *
   * CAB decisions
   * --------------------------------------------------------------------- */

  /**
   * Records the CAB's decision and moves the change accordingly: approved
   * applies Approve (iTop's approval date and comment from the meeting),
   * rejected applies Not approve (iTop's reason from the notes), deferred
   * leaves it waiting for the next meeting. Made as the caller, so iTop
   * checks their Change Approver rights on both and History shows them.
   */
  async decide(id: number, input: CabDecisionInput): Promise<ChangeGovernance> {
    if (!this.canDecide()) {
      throw new AppError("forbidden", `Only a ${APPROVER_PROFILE} records CAB decisions.`);
    }
    const change = await this.change(id);
    if (!change.available) throw extensionMissing();
    if (change.type === "routine") {
      throw badRequest("Routine changes are pre-approved: they do not go to the CAB.");
    }
    if (change.status !== "plannedscheduled") {
      throw new AppError(
        "conflict",
        `Only a planned change waits for the CAB; this one is ${(STATUS[change.status] ?? change.status).replace("_", " ")}.`,
      );
    }

    const notes = input.notes.trim();
    const conditions = input.conditions.trim();
    if (input.decision === "rejected" && !notes) {
      throw badRequest("Say why the CAB rejected the change (notes).");
    }
    const meeting = isoToItopTime(
      /^\d{4}-\d{2}-\d{2}$/.test(input.meetingDate) ? `${input.meetingDate}T12:00:00Z` : input.meetingDate,
      this.timeZone,
    );
    if (!meeting) throw badRequest("meetingDate must be a date or an ISO date-time.");
    const day = meeting.slice(0, 10);

    const caller = currentCaller();
    const created = await this.client.call("core/create", {
      class: "ChangeCabDecision",
      fields: {
        change_id: id,
        meeting_date: meeting,
        attendees: input.attendees.map((a) => a.trim()).filter(Boolean).join("\n"),
        decision: input.decision,
        conditions,
        notes,
        recorded_at: toItopTime(new Date(), this.timeZone),
        ...(caller && caller.contactId > 0 ? { recorded_by_id: caller.contactId } : {}),
      },
      comment: `CAB decision on ${str(change.fields["ref"])} via ARCUS`,
      output_fields: "id",
    });
    const decisionId = normalizeObjects(created.objects)[0]?.id;

    if (input.decision !== "deferred") {
      const approved = input.decision === "approved";
      const summary = [
        `CAB ${day}: ${approved ? "approved" : "not approved"}.`,
        approved && conditions ? `Conditions: ${conditions}` : "",
        !approved ? notes : "",
      ]
        .filter(Boolean)
        .join(" ");
      try {
        await this.client.call("core/apply_stimulus", {
          class: TYPE_CLASS[change.type],
          key: id,
          stimulus: approved ? "ev_approve" : "ev_notapprove",
          fields: approved
            ? { approval_date: meeting, approval_comment: clip(summary) }
            : { reason: clip(summary) },
          comment: `CAB decision recorded via ARCUS`,
          output_fields: "id",
        });
      } catch (error) {
        // The change did not move, so the decision did not happen: take its
        // record back out (as the BFF, since approvers may not delete them).
        if (decisionId) {
          await this.client
            .call("core/delete", { class: "ChangeCabDecision", key: decisionId, comment: "CAB decision rolled back" }, { asService: true })
            .catch(() => undefined);
        }
        throw error;
      }
    }
    return this.governance(id);
  }

  /** Normal and emergency changes that are planned and wait for the CAB. */
  async queue(): Promise<CabQueue> {
    const [result, rules] = await Promise.all([
      this.client.call("core/get", {
        class: "Change",
        key: "SELECT Change WHERE finalclass IN ('NormalChange','EmergencyChange') AND status = 'plannedscheduled'",
        output_fields: CHANGE_FIELDS,
        limit: QUEUE_CAP,
        page: 1,
      }),
      this.getRules(),
    ]);
    const changes = normalizeObjects(result.objects).map((row) => this.toRow(row));
    // Every change has the extension's fields or none does; with no change
    // to look at there is nothing to say it is missing.
    const available = changes[0]?.available ?? true;
    let decisions = new Map<number, CabDecision[]>();
    if (changes.length > 0 && available) {
      try {
        decisions = await this.decisions(changes.map((c) => c.id));
      } catch (error) {
        if (!isUnknownToItop(error)) throw error;
      }
    }

    const items: CabQueueItem[] = changes.map((change) => {
      const f = change.fields;
      const last = decisions.get(change.id)?.[0];
      return {
        id: String(change.id),
        ref: str(f["ref"]),
        title: str(f["title"]),
        type: change.type,
        organization: str(f["org_name"]),
        startDate: this.iso(f["start_date"]),
        endDate: this.iso(f["end_date"]),
        outage: str(f["outage"]) === "yes",
        impact: str(f["impact"]),
        ...(last ? { lastDecision: { decision: last.decision, meetingDate: last.meetingDate } } : {}),
        missingPlans: this.missing(change, rules.rules, this.plansOf(change), "implement"),
      };
    });
    // Soonest scheduled first; unscheduled last.
    items.sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999") || Number(a.id) - Number(b.id));
    return { items, available };
  }
}
