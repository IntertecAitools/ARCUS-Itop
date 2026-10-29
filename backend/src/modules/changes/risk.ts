import type { ChangeType, RiskLevel, RiskModel, RiskQuestion } from "./changes.types.js";

const CHANGE_TYPES: ChangeType[] = ["routine", "normal", "emergency"];

/** The top of an option's 0–10 scale. */
export const MAX_OPTION_SCORE = 10;

const q = (id: string, text: string, help: string, weight: number, options: Array<[string, string, number]>): RiskQuestion => ({
  id,
  text,
  help,
  weight,
  options: options.map(([oid, label, score]) => ({ id: oid, label, score })),
});

const IMPACT = q("impact", "If it goes wrong, what is affected?", "The widest reach of a failure.", 3, [
  ["one-team", "One team or a single CI", 0],
  ["one-service", "One business service", 4],
  ["several", "Several services", 7],
  ["business", "The whole business or customers", 10],
]);
const ROLLBACK = q("rollback", "How hard is it to roll back?", "", 3, [
  ["automatic", "Automatic or one step, tested", 0],
  ["documented", "Manual, documented", 4],
  ["untested", "Manual, never tried", 7],
  ["none", "Not possible", 10],
]);
const TESTING = q("testing", "What testing was done?", "", 2, [
  ["full", "Full test in a production-like environment", 0],
  ["partial", "Partial test", 4],
  ["dev", "Only in development", 7],
  ["none", "Not tested", 10],
]);
const HOURS = q("hours", "When does it run?", "Against the service's business hours.", 2, [
  ["outside", "Outside business hours", 0],
  ["quiet", "Business hours, quiet period", 5],
  ["peak", "Peak business hours", 10],
]);
const OUTAGE = q("outage", "Does it need an outage?", "", 2, [
  ["no", "No outage", 0],
  ["short", "A short, announced outage", 5],
  ["long", "A long or unannounced outage", 10],
]);
const EXPERIENCE = q("experience", "Has this kind of change been done before?", "", 1, [
  ["often", "Many times", 0],
  ["once", "Once or twice", 5],
  ["never", "Never", 10],
]);

/**
 * What a fresh platform asks. Routine changes are standard and pre-approved,
 * so they answer the short set; a high score there means the change is not
 * routine after all. No type requires the questionnaire until an
 * administrator says so.
 */
export const DEFAULT_RISK_MODEL: RiskModel = {
  questions: {
    routine: [IMPACT, ROLLBACK, HOURS],
    normal: [IMPACT, ROLLBACK, TESTING, HOURS, OUTAGE, EXPERIENCE],
    emergency: [IMPACT, ROLLBACK, TESTING, OUTAGE],
  },
  thresholds: { medium: 35, high: 65 },
  requiredBeforePlan: { routine: false, normal: false, emergency: false },
};

/** 0–100, or null while a question is unanswered (or answered with an option it no longer has). */
export function riskScore(questions: RiskQuestion[], answers: Record<string, string>): number | null {
  if (questions.length === 0) return null;
  let total = 0;
  let max = 0;
  for (const question of questions) {
    const option = question.options.find((o) => o.id === answers[question.id]);
    if (!option) return null;
    total += question.weight * option.score;
    max += question.weight * MAX_OPTION_SCORE;
  }
  return max === 0 ? 0 : Math.round((100 * total) / max);
}

export function riskLevel(score: number, thresholds: RiskModel["thresholds"]): RiskLevel {
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  return "low";
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function cleanQuestion(raw: unknown): RiskQuestion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!isText(r["id"], 64) || !isText(r["text"], 500) || !Array.isArray(r["options"])) return undefined;
  const options = (r["options"] as unknown[])
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .filter((o) => isText(o["id"], 64) && isText(o["label"], 255) && typeof o["score"] === "number")
    .map((o) => ({
      id: String(o["id"]),
      label: String(o["label"]),
      score: Math.min(MAX_OPTION_SCORE, Math.max(0, Math.round(Number(o["score"])))),
    }));
  if (options.length < 2) return undefined;
  const weight = typeof r["weight"] === "number" ? Math.min(10, Math.max(1, Math.round(r["weight"]))) : 1;
  return { id: r["id"] as string, text: r["text"] as string, help: typeof r["help"] === "string" ? r["help"] : "", weight, options };
}

/** A stored model, completed from the defaults so a damaged row never leaves a hole. */
export function completeRiskModel(stored: unknown): RiskModel {
  const out = structuredClone(DEFAULT_RISK_MODEL);
  if (!stored || typeof stored !== "object") return out;
  const s = stored as Record<string, unknown>;
  const questions = s["questions"] as Record<string, unknown> | undefined;
  const required = s["requiredBeforePlan"] as Record<string, unknown> | undefined;
  for (const type of CHANGE_TYPES) {
    const list = questions?.[type];
    if (Array.isArray(list)) out.questions[type] = list.map(cleanQuestion).filter((x): x is RiskQuestion => !!x);
    if (typeof required?.[type] === "boolean") out.requiredBeforePlan[type] = required[type] as boolean;
  }
  const t = s["thresholds"] as Record<string, unknown> | undefined;
  const medium = Number(t?.["medium"]);
  const high = Number(t?.["high"]);
  if (Number.isFinite(medium) && Number.isFinite(high) && medium > 0 && medium < high && high <= 100) {
    out.thresholds = { medium: Math.round(medium), high: Math.round(high) };
  }
  return out;
}
