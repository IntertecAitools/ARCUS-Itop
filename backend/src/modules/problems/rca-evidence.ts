import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import type { RelationsService } from "../../shared/relations.service.js";
import { itopFieldsToIso, toItopTime } from "../../shared/itop-time.js";
import { OPEN_STATES, str } from "../../shared/ticket-mapping.js";
import type { CmdbSchema } from "../../schema/load.js";
import { rankCandidates, titleSimilarity } from "./rca-scoring.js";
import type {
  CiRole,
  EvidenceChange,
  EvidenceCi,
  EvidenceIncident,
  EvidenceKnownError,
  EvidenceProblem,
  RcaEvidence,
  RcaEvidenceQuery,
  SimilarIncident,
} from "./problems.types.js";

/**
 * Gathers what a problem manager would look up by hand before writing a root
 * cause: the problem's incidents and similar ones, the CIs they name and what
 * those CIs depend on, changes made to them just before it started, and
 * earlier problems and known errors on the same CIs.
 *
 * Every read goes through the caller's own iTop account and the tenant guard,
 * so the evidence holds only what the caller could open themselves. A source
 * the caller may not read (no rights to changes, say) is listed in
 * `unavailable` instead of failing the whole answer.
 */

const INCIDENT_FIELDS = [
  "ref",
  "title",
  "status",
  "start_date",
  "service_id",
  "service_name",
  "servicesubcategory_id",
  "servicesubcategory_name",
  "functionalcis_list",
  "parent_change_id",
  "parent_change_ref",
  "parent_problem_id",
  "parent_problem_ref",
].join(",");

const PROBLEM_FIELDS = [
  "ref",
  "title",
  "status",
  "start_date",
  "service_id",
  "service_name",
  "servicesubcategory_id",
  "functionalcis_list",
  "related_change_id",
  "related_change_ref",
].join(",");

const CHANGE_FIELDS = "ref,title,status,start_date,end_date,functionalcis_list";

/** Bounds, so one problem cannot make the BFF read the whole CMDB. */
const CAPS = {
  linkedIncidents: 300,
  similarScan: 500,
  similarShown: 25,
  /** Affected CIs whose impact graph is walked. */
  graphRoots: 8,
  graphDepth: 3,
  relatedCis: 40,
  changes: 500,
  changesShown: 25,
  problems: 300,
  problemsShown: 15,
  knownErrors: 100,
};

/** Incidents opened this many days back count as "recent" for the similarity scan. */
const RECENT_DAYS = 30;

/** Ticket classes iTop's impact graph can include; they are not CIs. */
const NOT_CIS = new Set([
  "Incident", "Problem", "UserRequest", "Change", "NormalChange", "EmergencyChange", "RoutineChange",
  "Ticket", "WorkOrder", "KnownError",
]);

const HOUR = 3_600_000;

/**
 * The CIs a ticket names, as {id, name}: the ones linked by hand. iTop also
 * adds every CI the named ones impact (impact_code "computed"); those are
 * downstream of the fault, not where it is, and come in through the impact
 * graph instead.
 */
export function cisOf(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, { id: string; name: string }>();
  for (const row of value) {
    const r = (row ?? {}) as Record<string, unknown>;
    if (str(r["impact_code"]) === "computed") continue;
    const id = str(r["functionalci_id"]);
    if (id && id !== "0" && !seen.has(id)) seen.set(id, { id, name: str(r["functionalci_name"]) });
  }
  return [...seen.values()];
}

const idOrEmpty = (value: unknown) => {
  const s = str(value);
  return s === "0" ? "" : s;
};

export function toEvidenceIncident(item: ObjectDto): EvidenceIncident {
  const f = item.fields;
  const changeId = idOrEmpty(f["parent_change_id"]);
  return {
    id: String(item.id),
    ref: str(f["ref"]),
    title: str(f["title"]),
    status: str(f["status"]),
    startDate: str(f["start_date"]),
    serviceId: idOrEmpty(f["service_id"]),
    serviceName: str(f["service_name"]),
    subcategoryId: idOrEmpty(f["servicesubcategory_id"]),
    subcategoryName: str(f["servicesubcategory_name"]),
    cis: cisOf(f["functionalcis_list"]),
    ...(changeId ? { changeId, changeRef: str(f["parent_change_ref"]) } : {}),
  };
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
};

/** Why an incident not linked to the problem looks related; empty when it does not. */
export function similarityMatches(
  incident: EvidenceIncident,
  problem: { title: string; serviceId: string; subcategoryId: string },
  affected: Map<string, string>,
): string[] {
  const matches: string[] = [];
  for (const ci of incident.cis) if (affected.has(ci.id)) matches.push(`same CI ${ci.name}`);
  const sameSub = Boolean(problem.subcategoryId) && incident.subcategoryId === problem.subcategoryId;
  const sameService = Boolean(problem.serviceId) && incident.serviceId === problem.serviceId;
  const similarity = titleSimilarity(incident.title, problem.title);
  if (sameSub) matches.push(`same subcategory ${incident.subcategoryName}`);
  else if (sameService && (matches.length || similarity >= 0.2)) matches.push(`same service ${incident.serviceName}`);
  if (similarity >= 0.3) matches.push(`similar title (${Math.round(similarity * 100)}%)`);
  return matches;
}

/** A failing source becomes an `unavailable` entry instead of failing the answer. */
type Attempt = <T>(source: string, fallback: T, run: () => Promise<T>) => Promise<T>;

function attempts(unavailable: RcaEvidence["unavailable"]): Attempt {
  return async (source, fallback, run) => {
    try {
      return await run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unavailable.push({ source, reason: reason.slice(0, 300) });
      return fallback;
    }
  };
}

export class RcaEvidenceService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly relations: RelationsService,
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly timeZone: string,
    /** Whether "Draft with AI" is on for the current request. */
    private readonly aiEnabled: () => boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private oqlTime(instantMs: number): string {
    return toItopTime(new Date(instantMs), this.timeZone);
  }

  /** A missing problem, or another tenant's, is a 404 like everywhere else. */
  async gather(problemId: string, query: RcaEvidenceQuery): Promise<RcaEvidence> {
    const pid = Number(problemId);
    const unavailable: RcaEvidence["unavailable"] = [];
    const attempt = attempts(unavailable);

    const problem = await this.objects.get("Problem", pid, PROBLEM_FIELDS);
    const pf = problem.fields;
    const problemRef = str(pf["ref"]);
    const problemTitle = str(pf["title"]);
    const problemCis = cisOf(pf["functionalcis_list"]);
    const problemServiceId = idOrEmpty(pf["service_id"]);
    const problemSubcategoryId = idOrEmpty(pf["servicesubcategory_id"]);
    const relatedChangeId = idOrEmpty(pf["related_change_id"]);

    /* Incidents linked to the problem. */
    const linkedIncidents = await attempt("linked incidents", [] as EvidenceIncident[], async () => {
      const result = await this.objects.listAll(
        "Incident",
        { oql: `SELECT Incident WHERE parent_problem_id = ${pid}`, fields: INCIDENT_FIELDS },
        CAPS.linkedIncidents,
      );
      return result.items
        .map(toEvidenceIncident)
        .sort((a, b) => (ms(a.startDate) ?? 0) - (ms(b.startDate) ?? 0));
    });

    /* The anchor: the first incident, else the problem itself. */
    const first = linkedIncidents.find((i) => ms(i.startDate) !== undefined);
    const anchor = first
      ? { at: first.startDate, source: "incident" as const, ref: first.ref }
      : { at: str(pf["start_date"]) || this.now().toISOString(), source: "problem" as const, ref: problemRef };
    const anchorMs = ms(anchor.at) ?? this.now().getTime();

    /* Affected CIs, with how many incidents name each. */
    const affected = new Map<string, { id: string; name: string; count: number }>();
    for (const ci of problemCis) affected.set(ci.id, { ...ci, count: 0 });
    for (const incident of linkedIncidents) {
      for (const ci of incident.cis) {
        const entry = affected.get(ci.id) ?? { ...ci, count: 0 };
        entry.count += 1;
        affected.set(ci.id, entry);
      }
    }

    // Each CI's own class, so links and impact graphs use it.
    const classes = await attempt("configuration items", new Map<string, string>(), async () =>
      this.ciClasses([...affected.keys()]),
    );

    /* Upstream and downstream CIs, from iTop's impact relation. */
    const related = new Map<string, EvidenceCi>();
    const roots = [...affected.values()].sort((a, b) => b.count - a.count).slice(0, CAPS.graphRoots);
    await attempt("impact relations", undefined, async () => {
      for (const root of roots) {
        const cls = classes.get(root.id);
        if (!cls) continue;
        for (const direction of ["up", "down"] as const) {
          const graph = await this.relations.graph(cls, Number(root.id), {
            relation: "impacts",
            direction,
            depth: CAPS.graphDepth,
          });
          for (const node of graph.nodes) {
            const id = String(node.id);
            if (NOT_CIS.has(node.class) || affected.has(id) || related.has(id)) continue;
            if (related.size >= CAPS.relatedCis) break;
            related.set(id, {
              id,
              name: node.label,
              class: node.class,
              role: direction === "up" ? "upstream" : "downstream",
              incidentCount: 0,
              via: root.name,
            });
          }
        }
      }
    });

    const cis: EvidenceCi[] = [
      ...[...affected.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .map((ci) => ({
          id: ci.id,
          name: ci.name,
          class: classes.get(ci.id) ?? "FunctionalCI",
          role: "affected" as CiRole,
          incidentCount: ci.count,
        })),
      ...related.values(),
    ];
    const roleOf = new Map(cis.map((c) => [c.id, c.role]));

    /* Changes on those CIs in the look-back window, plus the ones iTop already links. */
    const changes = await attempt("changes", [] as EvidenceChange[], async () =>
      this.changes(
        anchorMs,
        query.lookbackHours,
        roleOf,
        new Set([relatedChangeId, ...linkedIncidents.map((i) => i.changeId ?? "")].filter(Boolean)),
        relatedChangeId,
        linkedIncidents,
      ),
    );

    const affectedNames = new Map([...affected.values()].map((c) => [c.id, c.name]));

    /* Similar incidents: open or recent, not linked to this problem. */
    const similarIncidents = await attempt("similar incidents", [] as SimilarIncident[], async () => {
      const since = this.oqlTime(this.now().getTime() - RECENT_DAYS * 24 * HOUR);
      const result = await this.objects.listAll(
        "Incident",
        {
          oql:
            `SELECT Incident WHERE parent_problem_id != ${pid} ` +
            `AND (status IN (${OPEN_STATES}) OR start_date >= '${since}')`,
          fields: INCIDENT_FIELDS,
        },
        CAPS.similarScan,
      );
      const problemKey = { title: problemTitle, serviceId: problemServiceId, subcategoryId: problemSubcategoryId };
      return result.items
        .map((item) => {
          const incident = toEvidenceIncident(item);
          const problemRefOf = idOrEmpty(item.fields["parent_problem_id"]) ? str(item.fields["parent_problem_ref"]) : "";
          return {
            ...incident,
            matches: similarityMatches(incident, problemKey, affectedNames),
            ...(problemRefOf ? { problemRef: problemRefOf } : {}),
          };
        })
        .filter((s) => s.matches.length > 0)
        .sort((a, b) => b.matches.length - a.matches.length || (ms(b.startDate) ?? 0) - (ms(a.startDate) ?? 0))
        .slice(0, CAPS.similarShown);
    });

    /* Earlier problems on the same CIs or service. */
    const problems = await attempt("past problems", [] as EvidenceProblem[], async () =>
      this.pastProblems(pid, affectedNames, problemServiceId),
    );

    /* Known errors recorded on the affected CIs. */
    const knownErrors = await attempt("known errors", [] as EvidenceKnownError[], async () =>
      this.knownErrors([...affected.keys()]),
    );

    const candidates = rankCandidates({
      problemRef,
      problemCiIds: problemCis.map((c) => c.id),
      linkedIncidents,
      cis,
      changes,
      problems,
      knownErrors,
      lookbackHours: query.lookbackHours,
      anchorRef: anchor.ref,
    });

    return {
      problemId: String(problem.id),
      ref: problemRef,
      title: problemTitle,
      generatedAt: this.now().toISOString(),
      lookbackHours: query.lookbackHours,
      anchor,
      linkedIncidents,
      similarIncidents,
      cis,
      changes,
      problems,
      knownErrors,
      candidates,
      unavailable,
      ai: { enabled: this.aiEnabled() },
    };
  }

  /** id -> concrete class (Server, DBServer…), for CIs the caller may read. */
  private async ciClasses(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const result = await this.objects.listAll(
      "FunctionalCI",
      { oql: `SELECT FunctionalCI WHERE id IN (${ids.map(Number).join(",")})`, fields: "name" },
      ids.length,
    );
    for (const item of result.items) out.set(String(item.id), item.class);
    return out;
  }

  private async changes(
    anchorMs: number,
    lookbackHours: number,
    roleOf: Map<string, CiRole>,
    linkedIds: Set<string>,
    relatedChangeId: string,
    incidents: EvidenceIncident[],
  ): Promise<EvidenceChange[]> {
    if (!roleOf.size && !linkedIds.size) return [];
    const from = this.oqlTime(anchorMs - lookbackHours * HOUR);
    const to = this.oqlTime(anchorMs);
    // Implemented in the window: started before the first incident, and
    // finished (or, with no planned end, started) after the look-back began.
    const windowed = await this.objects.listAll(
      "Change",
      {
        oql: `SELECT Change WHERE start_date <= '${to}' AND (end_date >= '${from}' OR start_date >= '${from}')`,
        fields: CHANGE_FIELDS,
      },
      CAPS.changes,
    );
    const items = windowed.items.filter((item) =>
      cisOf(item.fields["functionalcis_list"]).some((ci) => roleOf.has(ci.id)),
    );
    const missing = [...linkedIds].filter((id) => !items.some((i) => String(i.id) === id));
    if (missing.length) {
      const linked = await this.objects.listAll(
        "Change",
        { oql: `SELECT Change WHERE id IN (${missing.map(Number).join(",")})`, fields: CHANGE_FIELDS },
        missing.length,
      );
      items.push(...linked.items);
    }

    return items
      .map((item): EvidenceChange => {
        const f = item.fields;
        const startDate = str(f["start_date"]);
        const endDate = str(f["end_date"]);
        const start = ms(startDate) ?? anchorMs;
        const end = ms(endDate);
        const running = start <= anchorMs && end !== undefined && end > anchorMs;
        const reference = end !== undefined ? end : start;
        const hours = running ? -((end! - anchorMs) / HOUR) : (anchorMs - reference) / HOUR;
        const id = String(item.id);
        return {
          id,
          ref: str(f["ref"]),
          title: str(f["title"]),
          class: item.class,
          status: str(f["status"]),
          startDate,
          endDate,
          hoursBeforeFirstIncident: Math.round(hours * 10) / 10,
          cis: cisOf(f["functionalcis_list"])
            .filter((ci) => roleOf.has(ci.id))
            .map((ci) => ({ ...ci, role: roleOf.get(ci.id)! })),
          linkedIncidents: incidents.filter((i) => i.changeId === id).length,
          relatedToProblem: id === relatedChangeId,
        };
      })
      .sort((a, b) => Math.abs(a.hoursBeforeFirstIncident) - Math.abs(b.hoursBeforeFirstIncident))
      .slice(0, CAPS.changesShown);
  }

  /**
   * Read straight through the (scoped) client: root_cause comes from the
   * arcus-problem-rca extension, which the published schema leaves out, and
   * iTop simply omits it where the extension is missing.
   */
  private async pastProblems(
    pid: number,
    affected: Map<string, string>,
    serviceId: string,
  ): Promise<EvidenceProblem[]> {
    const conditions: string[] = [];
    if (serviceId) conditions.push(`service_id = ${Number(serviceId)}`);
    if (affected.size) {
      conditions.push(
        `id IN (SELECT Problem AS p JOIN lnkFunctionalCIToTicket AS l ON l.ticket_id = p.id ` +
          `WHERE l.functionalci_id IN (${[...affected.keys()].map(Number).join(",")}))`,
      );
    }
    if (!conditions.length) return [];
    const result = await this.client.call("core/get", {
      class: "Problem",
      key: `SELECT Problem WHERE id != ${pid} AND (${conditions.join(" OR ")})`,
      output_fields: "ref,title,status,start_date,service_id,functionalcis_list,root_cause",
      limit: CAPS.problems,
      page: 1,
    });
    return normalizeObjects(result.objects)
      .map((flat): EvidenceProblem => {
        const f = itopFieldsToIso(flat.fields, this.schema.get("Problem"), this.timeZone);
        return {
          id: String(flat.id),
          ref: str(f["ref"]),
          title: str(f["title"]),
          status: str(f["status"]),
          startDate: str(f["start_date"]),
          rootCause: str(f["root_cause"]),
          sharedCis: cisOf(f["functionalcis_list"]).filter((c) => affected.has(c.id)).map((c) => c.name),
          sameService: Boolean(serviceId) && idOrEmpty(f["service_id"]) === serviceId,
        };
      })
      .sort(
        (a, b) =>
          b.sharedCis.length - a.sharedCis.length ||
          Number(b.sameService) - Number(a.sameService) ||
          (ms(b.startDate) ?? 0) - (ms(a.startDate) ?? 0),
      )
      .slice(0, CAPS.problemsShown);
  }

  private async knownErrors(ciIds: string[]): Promise<EvidenceKnownError[]> {
    if (!ciIds.length) return [];
    const links = await this.objects.listAll(
      "lnkErrorToFunctionalCI",
      {
        oql: `SELECT lnkErrorToFunctionalCI WHERE functionalci_id IN (${ciIds.map(Number).join(",")})`,
        fields: "error_id,functionalci_id,functionalci_name",
      },
      CAPS.knownErrors * 4,
    );
    const cisByError = new Map<string, Array<{ id: string; name: string }>>();
    for (const link of links.items) {
      const errorId = idOrEmpty(link.fields["error_id"]);
      if (!errorId) continue;
      const list = cisByError.get(errorId) ?? [];
      list.push({ id: str(link.fields["functionalci_id"]), name: str(link.fields["functionalci_name"]) });
      cisByError.set(errorId, list);
    }
    if (!cisByError.size) return [];
    const errors = await this.objects.listAll(
      "KnownError",
      {
        oql: `SELECT KnownError WHERE id IN (${[...cisByError.keys()].map(Number).join(",")})`,
        fields: "name,problem_ref,root_cause,workaround",
      },
      CAPS.knownErrors,
    );
    return errors.items.map((item) => ({
      id: String(item.id),
      name: str(item.fields["name"]) || item.label,
      problemRef: str(item.fields["problem_ref"]),
      rootCause: str(item.fields["root_cause"]),
      workaround: str(item.fields["workaround"]),
      cis: cisByError.get(String(item.id)) ?? [],
    }));
  }
}
