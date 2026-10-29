import type {
  CandidateCause,
  EvidenceChange,
  EvidenceCi,
  EvidenceIncident,
  EvidenceKnownError,
  EvidenceProblem,
  RecordRef,
} from "./problems.types.js";

/**
 * The correlation assistant's arithmetic: which records most likely explain a
 * problem, scored 0-100 with every point accounted for in plain words. Kept
 * free of iTop calls so it can be tested on plain rows.
 *
 * The weights are deliberately simple, so a problem manager can check them:
 *
 * - A change: up to 40 for timing (finished just before the first incident,
 *   or still running then), up to 35 for touching the CIs the incidents name
 *   (less for a CI they depend on), up to 25 when iTop already links it (the
 *   problem's related change, or incidents raised against it).
 * - A CI: up to 45 for the share of incidents naming it, +15 when a change in
 *   the window touched it, +10 when a known error is recorded on it.
 * - A known error: 25 for sitting on an affected CI, up to 35 for that CI's
 *   share of the incidents.
 * - A past problem: up to 30 for shared CIs, +10 for the same service, +10
 *   when it has a recorded root cause to reuse.
 */

export const DEFAULT_LOOKBACK_HOURS = 72;

const WEIGHTS = {
  changeTiming: 40,
  changeCi: 35,
  changeUpstreamCi: 15,
  changeDownstreamCi: 5,
  changeLinked: 25,
  ciShare: 45,
  ciChanged: 15,
  ciKnownError: 10,
  knownErrorBase: 25,
  knownErrorShare: 35,
  problemShared: 30,
  problemService: 10,
  problemRootCause: 10,
} as const;

/** Below this a candidate is noise and is not shown. */
const MIN_SCORE = 10;
const MAX_CANDIDATES = 10;

export const confidenceOf = (score: number): CandidateCause["confidence"] =>
  score >= 70 ? "high" : score >= 40 ? "medium" : "low";

/** "45 min", "2h", "1.5 days". */
export function formatHours(hours: number): string {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`.replace(".0h", "h");
  return `${Math.round((h / 24) * 10) / 10} days`.replace(".0 days", " days");
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "not", "are", "was", "from", "after", "when", "this", "that",
  "can", "cannot", "does", "into", "on", "in", "of", "to", "is", "a", "an", "be", "has", "have",
]);

/** The words of a title that carry meaning, lower-cased. */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity of two titles' meaningful words, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

const round = (n: number) => Math.round(n);
const clamp = (n: number) => Math.max(0, Math.min(100, round(n)));

export interface ScoringInput {
  problemRef: string;
  /** The problem's own CIs (it may have none). */
  problemCiIds: string[];
  linkedIncidents: EvidenceIncident[];
  cis: EvidenceCi[];
  changes: EvidenceChange[];
  problems: EvidenceProblem[];
  knownErrors: EvidenceKnownError[];
  lookbackHours: number;
  /** The record changes are timed against (first incident, else the problem). */
  anchorRef: string;
}

/** How many linked incidents name each CI. */
function incidentsPerCi(incidents: EvidenceIncident[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const incident of incidents) {
    for (const id of new Set(incident.cis.map((c) => c.id))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

const ciRef = (ci: { id: string; name: string; class?: string }): RecordRef => ({
  class: ci.class || "FunctionalCI",
  id: ci.id,
  label: ci.name,
});

function scoreChange(change: EvidenceChange, input: ScoringInput, perCi: Map<string, number>): CandidateCause {
  const n = input.linkedIncidents.length;
  const reasons: CandidateCause["reasons"] = [];
  const related: RecordRef[] = [];

  // Timing.
  const h = change.hoursBeforeFirstIncident;
  if (h < 0) {
    reasons.push({
      text: `Was still being implemented when ${input.anchorRef} opened`,
      points: WEIGHTS.changeTiming,
    });
  } else if (h <= input.lookbackHours) {
    const points = Math.max(5, round(WEIGHTS.changeTiming * (1 - h / input.lookbackHours)));
    reasons.push({
      text: `${change.endDate ? "Finished" : "Started"} ${formatHours(h)} before ${input.anchorRef}`,
      points,
    });
  }

  // The CIs it touched.
  const direct = change.cis.filter((c) => c.role === "affected");
  if (direct.length) {
    const best = direct
      .map((c) => ({ ci: c, k: perCi.get(c.id) ?? 0 }))
      .sort((a, b) => b.k - a.k)[0]!;
    const onProblem = input.problemCiIds.includes(best.ci.id);
    const points =
      n > 0 && best.k > 0
        ? round(WEIGHTS.changeCi * (best.k / n))
        : onProblem
          ? round(WEIGHTS.changeCi * 0.6)
          : round(WEIGHTS.changeCi * 0.3);
    reasons.push({
      text:
        n > 0 && best.k > 0
          ? `Touches ${best.ci.name}, named by ${best.k} of ${n} incident${n === 1 ? "" : "s"}`
          : `Touches ${best.ci.name}, ${onProblem ? "a CI of the problem" : "an affected CI"}`,
      points,
    });
    related.push(...direct.map(ciRef));
  } else {
    const upstream = change.cis.find((c) => c.role === "upstream");
    const downstream = change.cis.find((c) => c.role === "downstream");
    if (upstream) {
      const via = input.cis.find((c) => c.id === upstream.id)?.via;
      reasons.push({
        text: `Touches ${upstream.name}${via ? `, which ${via} depends on` : ", upstream of an affected CI"}`,
        points: WEIGHTS.changeUpstreamCi,
      });
      related.push(ciRef(upstream));
    } else if (downstream) {
      reasons.push({
        text: `Touches ${downstream.name}, which depends on an affected CI`,
        points: WEIGHTS.changeDownstreamCi,
      });
      related.push(ciRef(downstream));
    }
  }

  // What iTop already links.
  if (change.relatedToProblem) {
    reasons.push({ text: `Recorded as the related change of ${input.problemRef}`, points: WEIGHTS.changeLinked });
  } else if (change.linkedIncidents > 0 && n > 0) {
    reasons.push({
      text: `${change.linkedIncidents} of ${n} incident${n === 1 ? " is" : "s are"} linked to it in iTop`,
      points: round(WEIGHTS.changeLinked * Math.min(1, change.linkedIncidents / n)),
    });
  }

  const score = clamp(reasons.reduce((sum, r) => sum + r.points, 0));
  const when =
    h < 0 ? `in progress at the first incident` : `${formatHours(h)} before the first incident`;
  const where = change.cis.length ? ` on ${change.cis.map((c) => c.name).slice(0, 2).join(", ")}` : "";
  return {
    kind: "change",
    record: { class: change.class || "Change", id: change.id, label: change.ref },
    score,
    confidence: confidenceOf(score),
    summary: `Change ${change.ref}${where}, ${when}`,
    reasons,
    related,
  };
}

function scoreCi(
  ci: EvidenceCi,
  input: ScoringInput,
  perCi: Map<string, number>,
): CandidateCause | undefined {
  const n = input.linkedIncidents.length;
  const k = perCi.get(ci.id) ?? 0;
  // A CI is a cause candidate only when incidents cluster on it.
  if (ci.role !== "affected" || n < 2 || k < 2) return undefined;
  const reasons: CandidateCause["reasons"] = [
    { text: `Named by ${k} of ${n} incidents`, points: round(WEIGHTS.ciShare * (k / n)) },
  ];
  const related: RecordRef[] = [];
  const changed = input.changes.filter((c) => c.cis.some((x) => x.id === ci.id));
  if (changed.length) {
    reasons.push({
      text: `Changed shortly before: ${changed.map((c) => c.ref).slice(0, 3).join(", ")}`,
      points: WEIGHTS.ciChanged,
    });
    related.push(...changed.map((c) => ({ class: c.class || "Change", id: c.id, label: c.ref })));
  }
  const errors = input.knownErrors.filter((e) => e.cis.some((x) => x.id === ci.id));
  if (errors.length) {
    reasons.push({
      text: `Has a known error: ${errors.map((e) => e.name).slice(0, 2).join(", ")}`,
      points: WEIGHTS.ciKnownError,
    });
    related.push(...errors.map((e) => ({ class: "KnownError", id: e.id, label: e.name })));
  }
  const score = clamp(reasons.reduce((sum, r) => sum + r.points, 0));
  return {
    kind: "ci",
    record: ciRef(ci),
    score,
    confidence: confidenceOf(score),
    summary: `${ci.name} is common to ${k} of ${n} incidents`,
    reasons,
    related,
  };
}

function scoreKnownError(
  error: EvidenceKnownError,
  input: ScoringInput,
  perCi: Map<string, number>,
): CandidateCause | undefined {
  const n = input.linkedIncidents.length;
  const affected = input.cis.filter((c) => c.role === "affected" && error.cis.some((x) => x.id === c.id));
  if (!affected.length) return undefined;
  const best = affected.map((c) => ({ ci: c, k: perCi.get(c.id) ?? 0 })).sort((a, b) => b.k - a.k)[0]!;
  const reasons: CandidateCause["reasons"] = [
    { text: `Recorded on ${best.ci.name}, an affected CI`, points: WEIGHTS.knownErrorBase },
  ];
  if (n > 0 && best.k > 0) {
    reasons.push({
      text: `${best.ci.name} is named by ${best.k} of ${n} incident${n === 1 ? "" : "s"}`,
      points: round(WEIGHTS.knownErrorShare * (best.k / n)),
    });
  }
  if (error.workaround) reasons.push({ text: "Has a documented workaround", points: 0 });
  const score = clamp(reasons.reduce((sum, r) => sum + r.points, 0));
  return {
    kind: "known_error",
    record: { class: "KnownError", id: error.id, label: error.name },
    score,
    confidence: confidenceOf(score),
    summary: `Known error "${error.name}"${error.rootCause ? `: ${error.rootCause.slice(0, 120)}` : ""}`,
    reasons,
    related: affected.map(ciRef),
  };
}

function scoreProblem(problem: EvidenceProblem, input: ScoringInput): CandidateCause | undefined {
  const affectedCount = input.cis.filter((c) => c.role === "affected").length;
  const reasons: CandidateCause["reasons"] = [];
  if (problem.sharedCis.length) {
    const share = affectedCount ? Math.min(1, problem.sharedCis.length / affectedCount) : 1;
    reasons.push({
      text: `Shares ${problem.sharedCis.slice(0, 3).join(", ")}`,
      points: round(WEIGHTS.problemShared * Math.max(0.5, share)),
    });
  }
  if (problem.sameService) reasons.push({ text: "Same service", points: WEIGHTS.problemService });
  if (!reasons.length) return undefined;
  if (problem.rootCause) {
    reasons.push({ text: `Its recorded root cause: "${problem.rootCause.slice(0, 160)}"`, points: WEIGHTS.problemRootCause });
  }
  const score = clamp(reasons.reduce((sum, r) => sum + r.points, 0));
  return {
    kind: "problem",
    record: { class: "Problem", id: problem.id, label: problem.ref },
    score,
    confidence: confidenceOf(score),
    summary: `Earlier problem ${problem.ref}: ${problem.title}`,
    reasons,
    related: [],
  };
}

/** The likely causes, best first, with the noise left out. */
export function rankCandidates(input: ScoringInput): CandidateCause[] {
  const perCi = incidentsPerCi(input.linkedIncidents);
  const all: Array<CandidateCause | undefined> = [
    ...input.changes.map((c) => scoreChange(c, input, perCi)),
    ...input.cis.map((c) => scoreCi(c, input, perCi)),
    ...input.knownErrors.map((e) => scoreKnownError(e, input, perCi)),
    ...input.problems.map((p) => scoreProblem(p, input)),
  ];
  return all
    .filter((c): c is CandidateCause => c !== undefined && c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.record.label.localeCompare(b.record.label))
    .slice(0, MAX_CANDIDATES);
}
