import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import { str, toCaseLog } from "../../shared/ticket-mapping.js";
import type { RcaConfig } from "../../config/env.js";
import { auditEntry, buildRcaPrompt, parseDraft, RCA_DRAFT_SCHEMA, type LogEntry, type RcaContext, type RcaModel, type TicketText } from "./rca-ai.js";
import type { RcaEvidenceService } from "./rca-evidence.js";
import { DEFAULT_LOOKBACK_HOURS } from "./rca-scoring.js";
import { htmlToText } from "./text.js";
import type { RcaDraft, RcaEvidence, RcaEvidenceQuery } from "./problems.types.js";

/** Where the audit line goes: the request's logger. */
export interface AuditLog {
  info(obj: unknown, msg?: string): void;
}

/** Linked incidents whose words go to the model; the evidence lists them all. */
const INCIDENT_TEXTS = 25;

function logOf(value: unknown): LogEntry[] {
  // Newest first, as iTop keeps them; authors are left out on purpose.
  return toCaseLog(value)
    .map((e) => ({ date: e.date, message: htmlToText(e.message) }))
    .filter((e) => e.message);
}

function ticketText(item: ObjectDto, privateLogs: boolean): TicketText {
  const f = item.fields;
  return {
    ref: str(f["ref"]),
    title: str(f["title"]),
    description: htmlToText(str(f["description"])),
    publicLog: logOf(f["public_log"]),
    ...(privateLogs ? { privateLog: logOf(f["private_log"]) } : {}),
  };
}

/**
 * Root-cause help on a problem: the rule-based evidence, and the AI draft
 * built on it when RCA_AI is configured.
 */
export class RcaService {
  constructor(
    private readonly evidenceService: RcaEvidenceService,
    private readonly objects: ObjectsService,
    private readonly config: RcaConfig,
    /** Absent without ANTHROPIC_API_KEY (or with RCA_AI=off). */
    private readonly model?: RcaModel,
  ) {}

  get defaultLookbackHours(): number {
    return this.config.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  }

  /** On when configured, and not turned off for the request's tenant. */
  aiEnabled(): boolean {
    if (!this.model || !this.config.ai) return false;
    const tenant = currentTenant();
    return !(tenant && this.config.ai.disabledTenants.includes(tenant.id));
  }

  evidence(problemId: string, query: Partial<RcaEvidenceQuery> = {}): Promise<RcaEvidence> {
    return this.evidenceService.gather(problemId, {
      lookbackHours: query.lookbackHours ?? this.defaultLookbackHours,
    });
  }

  /** The words of the problem and its first incidents, read as the caller. */
  private async context(evidence: RcaEvidence): Promise<RcaContext> {
    const privateLogs = this.config.ai?.privateLogs ?? false;
    const problem = await this.objects.get(
      "Problem",
      Number(evidence.problemId),
      `ref,title,description${privateLogs ? ",private_log" : ""}`,
    );
    const ids = evidence.linkedIncidents.slice(0, INCIDENT_TEXTS).map((i) => Number(i.id));
    const incidents = ids.length
      ? await this.objects.listAll(
          "Incident",
          {
            oql: `SELECT Incident WHERE id IN (${ids.join(",")})`,
            fields: `ref,title,description,public_log${privateLogs ? ",private_log" : ""}`,
          },
          ids.length,
        )
      : { items: [] };
    const order = new Map(ids.map((id, i) => [String(id), i]));
    return {
      problem: ticketText(problem, privateLogs),
      incidents: incidents.items
        .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0))
        .map((item) => ticketText(item, privateLogs)),
      omittedIncidents: Math.max(0, evidence.linkedIncidents.length - ids.length),
    };
  }

  /** A draft for the problem manager to review. Saves nothing. */
  async draft(problemId: string, query: Partial<RcaEvidenceQuery>, audit: AuditLog): Promise<RcaDraft> {
    if (!this.aiEnabled() || !this.model || !this.config.ai) {
      throw new AppError("forbidden", "Drafting with AI is not turned on here.");
    }
    const evidence = await this.evidence(problemId, query);
    const context = await this.context(evidence);
    const prompt = buildRcaPrompt(evidence, context);

    const caller = currentCaller();
    const tenant = currentTenant();
    audit.info(
      auditEntry(prompt, {
        problemRef: evidence.ref,
        login: caller?.login ?? "(service account)",
        ...(tenant ? { tenant: tenant.id } : {}),
        model: this.config.ai.model,
      }),
      "RCA draft requested from the AI service",
    );

    const answer = await this.model.complete({ system: prompt.system, user: prompt.user, schema: { ...RCA_DRAFT_SCHEMA } });
    audit.info(
      { event: "rca_ai_response", problem: evidence.ref, model: answer.model, usage: answer.usage },
      "RCA draft received",
    );
    return parseDraft(answer, evidence, prompt.redactions);
  }
}
