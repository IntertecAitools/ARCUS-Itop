import { AppError, badRequest } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import type { DocStore } from "../../shared/doc-store.js";
import { DONE_STATUSES, readChange, STATUS, tenantKey } from "./change-model.js";
import type {
  ChangeType,
  PlanGate,
  RiskAssessment,
  RiskLevel,
  RiskModel,
  RiskModelDto,
} from "./changes.types.js";
import { completeRiskModel, DEFAULT_RISK_MODEL, riskLevel, riskScore } from "./risk.js";

const MODEL_KIND = "change-risk-model";
const ANSWERS_KIND = "change-risk";

interface StoredAnswers {
  type: ChangeType;
  answers: Record<string, string>;
  score: number;
  level: RiskLevel;
}

/**
 * The risk questionnaire: weighted questions per change type (an
 * administrator edits them), the answers and score kept with each change in
 * the BFF's own database, since iTop's Change has no field for them. A high
 * risk keeps a routine change from going ahead as pre-approved: it must be
 * raised as a normal change, which the CAB reviews.
 */
export class ChangeRiskService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: DocStore,
  ) {}

  async getModel(): Promise<RiskModelDto> {
    const stored = await this.store.get<RiskModel>(tenantKey(), MODEL_KIND, "model");
    return {
      model: stored ? completeRiskModel(stored.body) : structuredClone(DEFAULT_RISK_MODEL),
      defaults: structuredClone(DEFAULT_RISK_MODEL),
      updatedAt: stored?.updatedAt ?? "",
      updatedBy: stored?.updatedBy ?? "",
    };
  }

  async saveModel(model: RiskModel): Promise<RiskModelDto> {
    for (const [type, questions] of Object.entries(model.questions)) {
      const ids = questions.map((q) => q.id);
      if (new Set(ids).size !== ids.length) throw badRequest(`Two ${type} questions share an id.`);
      for (const question of questions) {
        const optionIds = question.options.map((o) => o.id);
        if (new Set(optionIds).size !== optionIds.length) {
          throw badRequest(`Two answers to "${question.text}" share an id.`);
        }
      }
    }
    if (model.thresholds.medium >= model.thresholds.high) {
      throw badRequest("The medium threshold must be below the high one.");
    }
    await this.store.put(tenantKey(), MODEL_KIND, "model", completeRiskModel(model), currentCaller()?.login ?? "");
    return this.getModel();
  }

  private stored(changeId: number) {
    return this.store.get<StoredAnswers>(tenantKey(), ANSWERS_KIND, String(changeId));
  }

  async get(id: number): Promise<RiskAssessment> {
    const [change, { model }, stored] = await Promise.all([
      readChange(this.client, id),
      this.getModel(),
      this.stored(id),
    ]);
    const questions = model.questions[change.type];
    const answers = stored?.body.answers ?? {};
    // A change re-typed since (or a damaged row) is assessed afresh.
    const kept = stored && stored.body.type === change.type ? stored : undefined;
    const level = kept?.body.level ?? null;
    return {
      changeId: String(change.id),
      ref: change.ref,
      type: change.type,
      status: STATUS[change.status] ?? "new",
      questions,
      answers: kept ? answers : {},
      score: kept?.body.score ?? null,
      level,
      thresholds: model.thresholds,
      assessedBy: kept?.updatedBy ?? "",
      assessedAt: kept?.updatedAt ?? "",
      stale: !!kept && riskScore(questions, answers) === null,
      required: model.requiredBeforePlan[change.type] && questions.length > 0,
      forcesCab: change.type === "routine" && level === "high",
      canEdit: !DONE_STATUSES.includes(change.status) && !["rejected", "notapproved"].includes(change.status),
    };
  }

  /** Every question answered, with one of its options: the score is then whole. */
  async answer(id: number, answers: Record<string, string>): Promise<RiskAssessment> {
    const [change, { model }] = await Promise.all([readChange(this.client, id), this.getModel()]);
    if (DONE_STATUSES.includes(change.status)) {
      throw new AppError("conflict", "The change is already implemented: its risk can no longer be assessed.");
    }
    const questions = model.questions[change.type];
    if (questions.length === 0) throw badRequest(`There are no risk questions for ${change.type} changes.`);
    const unanswered = questions.filter((q) => !q.options.some((o) => o.id === answers[q.id]));
    if (unanswered.length > 0) {
      throw badRequest(`Answer every question: ${unanswered.map((q) => `"${q.text}"`).join(", ")}.`, {
        unanswered: unanswered.map((q) => q.id),
      });
    }
    const kept = Object.fromEntries(questions.map((q) => [q.id, answers[q.id]!]));
    const score = riskScore(questions, kept)!;
    await this.store.put<StoredAnswers>(
      tenantKey(),
      ANSWERS_KIND,
      String(id),
      { type: change.type, answers: kept, score, level: riskLevel(score, model.thresholds) },
      currentCaller()?.login ?? "",
    );
    return this.get(id);
  }

  /** The level of each assessed change, for the calendar. */
  async levels(ids: number[]): Promise<Map<number, RiskLevel>> {
    const wanted = new Set(ids);
    const out = new Map<number, RiskLevel>();
    if (wanted.size === 0) return out;
    for (const doc of await this.store.list<StoredAnswers>(tenantKey(), ANSWERS_KIND)) {
      const id = Number(doc.key);
      if (wanted.has(id)) out.set(id, doc.body.level);
    }
    return out;
  }

  /**
   * ChangesService asks this before Plan and Implement (a GateCheck): the
   * questionnaire answered when the administrator requires it, and no high
   * risk on a routine change.
   */
  async check(changeId: number, type: ChangeType, gate: PlanGate): Promise<void> {
    const [{ model }, stored] = await Promise.all([this.getModel(), this.stored(changeId)]);
    const kept = stored && stored.body.type === type ? stored.body : undefined;
    const questions = model.questions[type];
    if (
      gate === "plan" &&
      model.requiredBeforePlan[type] &&
      questions.length > 0 &&
      (!kept || riskScore(questions, kept.answers) === null)
    ) {
      throw new AppError(
        "conflict",
        `Answer the risk questionnaire before planning this ${type} change (the Risk tab).`,
        { details: { reason: "risk_missing" } },
      );
    }
    if (type === "routine" && kept?.level === "high") {
      throw new AppError(
        "conflict",
        "This routine change scored high risk, so it cannot go ahead as pre-approved: raise it as a normal " +
          "change, which goes to the CAB.",
        { details: { reason: "risk_needs_cab" } },
      );
    }
  }
}
