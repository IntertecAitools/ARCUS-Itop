import { AppError, badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { ObjectsService } from "../../platform/objects/objects.service.js";
import { itopDay } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import { htmlToText } from "./text.js";
import { buildTrends, type TrendRow, windowStart } from "./trends.js";
import type {
  CreateKnownErrorInput,
  KnownErrorCreated,
  KnownErrorSummary,
  ProblemAnalysis,
  ProblemTrends,
  RootCauseAnalysis,
  TrendQuery,
} from "./problems.types.js";

/**
 * The analysis lives in three fields the `arcus-problem-rca` iTop extension
 * adds to Problem (itop-extensions/arcus-problem-rca). They are not in the
 * published CMDB schema, so the generic record screens and every other read
 * keep working on an iTop without the extension; this service alone reads
 * and writes them, straight through the (tenant-scoped) client.
 */
const RCA_FIELDS: Record<keyof RootCauseAnalysis, string> = {
  rootCause: "root_cause",
  workaround: "workaround",
  resolution: "solution",
};

const PROBLEM_FIELDS = [
  "ref",
  "title",
  "status",
  "description",
  "org_id",
  "functionalcis_list",
  ...Object.values(RCA_FIELDS),
].join(",");

const extensionMissing = () =>
  new AppError(
    "conflict",
    "This iTop has no root-cause fields on problems: install the arcus-problem-rca extension " +
      "(backend/README.md, \"Problems\").",
    { details: { reason: "extension_missing" } },
  );

interface ProblemRow {
  id: number;
  fields: Record<string, unknown>;
}

/** Most incidents (and, separately, problems) one trend reads. */
const TREND_CAP = 5000;

const TREND_FIELDS = [
  "ref",
  "start_date",
  "service_id",
  "service_name",
  "servicesubcategory_id",
  "servicesubcategory_name",
];

/** iTop's KnownError.name is a VARCHAR(255). */
const NAME_MAX = 255;

/** The CIs of a ticket's functionalcis_list, as {id, name}. */
function cisOf(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return { id: str(r["functionalci_id"]), name: str(r["functionalci_name"]) };
  });
}

const pick = (input: RootCauseAnalysis): RootCauseAnalysis => ({
  rootCause: input.rootCause.trim(),
  workaround: input.workaround.trim(),
  resolution: input.resolution.trim(),
});

function toTrendRow(item: { id: number; fields: Record<string, unknown> }): TrendRow {
  const f = item.fields;
  return {
    id: String(item.id),
    ref: str(f["ref"]),
    startDate: str(f["start_date"]),
    status: str(f["status"]) || undefined,
    serviceId: str(f["service_id"]),
    serviceName: str(f["service_name"]),
    categoryId: str(f["servicesubcategory_id"]),
    categoryName: str(f["servicesubcategory_name"]),
    cis: cisOf(f["functionalcis_list"]),
    problemId: str(f["parent_problem_id"]) || undefined,
    problemRef: str(f["parent_problem_ref"]) || undefined,
  };
}

/**
 * Problem management on top of the generic record screens: the root-cause
 * analysis, known errors raised from a problem, and the recurring-incident
 * trend. Lists, forms, lifecycle and links stay with the records module.
 */
export class ProblemsService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly client: ItopClient,
    private readonly timeZone: string,
  ) {}

  /* --------------------------------------------------------------------- *
   * Root-cause analysis
   * --------------------------------------------------------------------- */

  /**
   * The problem with its analysis fields. iTop leaves an attribute it does not
   * have out of a core/get answer rather than failing, so their absence is
   * how a missing extension shows.
   */
  private async problem(id: string): Promise<ProblemRow> {
    const result = await this.client.call("core/get", {
      class: "Problem",
      key: Number(id),
      output_fields: PROBLEM_FIELDS,
    });
    const row = normalizeObjects(result.objects)[0];
    if (!row) throw notFound(`Problem ${id} was not found.`);
    return { id: row.id, fields: row.fields };
  }

  private async knownErrors(problemId: string): Promise<KnownErrorSummary[]> {
    const result = await this.objects.list("KnownError", {
      page: 1,
      limit: 100,
      oql: `SELECT KnownError WHERE problem_id = ${Number(problemId)}`,
      fields: "name",
    });
    return result.items.map((item) => ({
      id: String(item.id),
      name: str(item.fields["name"]) || item.label,
    }));
  }

  private toAnalysis(problem: ProblemRow, knownErrors: KnownErrorSummary[]): ProblemAnalysis {
    const f = problem.fields;
    return {
      problemId: String(problem.id),
      ref: str(f["ref"]),
      title: str(f["title"]),
      status: str(f["status"]),
      available: RCA_FIELDS.rootCause in f,
      rootCause: str(f[RCA_FIELDS.rootCause]),
      workaround: str(f[RCA_FIELDS.workaround]),
      resolution: str(f[RCA_FIELDS.resolution]),
      knownErrors,
    };
  }

  /** A missing problem (or another tenant's) is a 404. */
  async getAnalysis(id: string): Promise<ProblemAnalysis> {
    const [problem, knownErrors] = await Promise.all([this.problem(id), this.knownErrors(id)]);
    return this.toAnalysis(problem, knownErrors);
  }

  /** Writes the changed fields only; saving what is already there writes nothing. */
  async saveAnalysis(id: string, input: RootCauseAnalysis): Promise<ProblemAnalysis> {
    const current = await this.getAnalysis(id);
    if (!current.available) throw extensionMissing();

    const fields: Record<string, string> = {};
    for (const [key, code] of Object.entries(RCA_FIELDS) as Array<[keyof RootCauseAnalysis, string]>) {
      const value = input[key].trim();
      if (value !== current[key]) fields[code] = value;
    }
    if (Object.keys(fields).length === 0) return current;

    try {
      await this.client.call("core/update", {
        class: "Problem",
        key: Number(id),
        fields,
        comment: "Root-cause analysis updated via ARCUS",
        output_fields: "id",
      });
    } catch (error) {
      if (error instanceof AppError && /Unknown attribute/i.test(error.message)) throw extensionMissing();
      throw error;
    }
    return { ...current, ...pick(input) };
  }

  /* --------------------------------------------------------------------- *
   * Known errors
   * --------------------------------------------------------------------- */

  /**
   * Raises a known error from the problem in one step: the analysis is
   * copied (root cause, workaround, resolution as the solution), it points
   * back at the problem, and the problem's CIs are linked to it.
   */
  async createKnownError(id: string, input: CreateKnownErrorInput): Promise<KnownErrorCreated> {
    const problem = await this.problem(id);
    const analysis = this.toAnalysis(problem, []);
    if (!analysis.available) throw extensionMissing();
    if (!analysis.rootCause && !analysis.workaround) {
      throw badRequest("Record the root cause or a workaround before raising a known error.");
    }

    const f = problem.fields;
    const name = (input.name?.trim() || `${analysis.ref}: ${analysis.title}`).slice(0, NAME_MAX);
    const symptom =
      input.symptom?.trim() || htmlToText(str(f["description"])) || analysis.title || analysis.ref;

    const fields: Record<string, unknown> = {
      name,
      org_id: Number(str(f["org_id"])),
      problem_id: Number(id),
      symptom,
      domain: input.domain ?? "Application",
    };
    if (analysis.rootCause) fields["root_cause"] = analysis.rootCause;
    if (analysis.workaround) fields["workaround"] = analysis.workaround;
    if (analysis.resolution) fields["solution"] = analysis.resolution;
    if (input.errorCode?.trim()) fields["error_code"] = input.errorCode.trim();

    const { object } = await this.objects.create("KnownError", fields, {
      fields: "name",
      comment: `Known error raised from ${analysis.ref} via ARCUS`,
    });

    // One at a time: each is a write to iTop, and a CI the agent may not link
    // (another organisation's, say) must not lose the known error itself.
    let linkedCis = 0;
    const cis = [...new Map(cisOf(f["functionalcis_list"]).map((ci) => [ci.id, ci])).values()];
    for (const ci of cis) {
      if (!ci.id || ci.id === "0") continue;
      try {
        await this.objects.addLink("KnownError", object.id, "ci_list", Number(ci.id), {
          reason: `From ${analysis.ref}`,
        });
        linkedCis += 1;
      } catch {
        // Counted as not linked; the agent can add it from the known error.
      }
    }

    return {
      id: String(object.id),
      name: str(object.fields["name"]) || name,
      problemId: String(problem.id),
      linkedCis,
    };
  }

  /* --------------------------------------------------------------------- *
   * Trends
   * --------------------------------------------------------------------- */

  async trends(query: TrendQuery): Promise<ProblemTrends> {
    const today = itopDay(new Date(), this.timeZone);
    const since = `start_date >= '${windowStart(today, query.period)} 00:00:00'`;
    const extra = query.groupBy === "ci" ? ["functionalcis_list"] : [];

    const [incidents, problems] = await Promise.all([
      this.objects.listAll(
        "Incident",
        {
          oql: `SELECT Incident WHERE ${since}`,
          fields: [...TREND_FIELDS, "parent_problem_id", "parent_problem_ref", ...extra].join(","),
        },
        TREND_CAP,
      ),
      this.objects.listAll(
        "Problem",
        { oql: `SELECT Problem WHERE ${since}`, fields: [...TREND_FIELDS, "status", ...extra].join(",") },
        TREND_CAP,
      ),
    ]);

    return buildTrends({
      period: query.period,
      groupBy: query.groupBy,
      today,
      timeZone: this.timeZone,
      incidents: incidents.items.map(toTrendRow),
      problems: problems.items.map(toTrendRow),
      truncated: incidents.truncated || problems.truncated,
    });
  }
}
