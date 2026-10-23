import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import { phpList, phpUnserialize, type PhpValue } from "../../shared/php-unserialize.js";
import { itopTimeToIso, toItopTime } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import { newestRows } from "../objects/objects.service.js";
import { plain } from "../inbox/inbox.service.js";
import type {
  ApprovalAnswer,
  ApprovalDecision,
  ApprovalDetail,
  ApprovalLevel,
  ApprovalList,
  ApprovalRequestInfo,
  ApprovalStatus,
  ApprovalSummary,
  RecordApproval,
} from "./approvals.types.js";

/**
 * Approvals, on top of Combodo's approval extension ("Approval process
 * automation": approval-base + combodo-approval-extended).
 *
 * The extension decides who approves (ApprovalRule, per service
 * subcategory), keeps one ApprovalScheme per request with its levels
 * ("steps", PHP-serialized), and moves the UserRequest to approved or
 * rejected once a level concludes. Approvers normally answer through a
 * one-click page in iTop (approval-base/approve.php) reached from an email,
 * which needs no iTop account: a token of
 * `<scheme>-<step>-<contact class>-<contact id>-<passcode>`.
 *
 * Nobody here uses iTop, so this service is the approvers' way in:
 *
 *   - it reads the schemes as the service account (approvers are often end
 *     users, whom iTop's REST API refuses) and is therefore the access
 *     control: a user only ever sees approvals they are an approver (or a
 *     substitute) on, matched on the Person linked to their account;
 *   - it answers by posting to approve.php with that user's token, so iTop
 *     runs its own logic (next level, timeouts, the ticket's transition) and
 *     records "Approved by <their name>" exactly as from the email. The
 *     passcode never leaves the BFF.
 */

/** The ticket class the extension approves. */
const APPROVED_CLASS = "UserRequest";
const SCHEME_FIELDS = "id,obj_class,obj_key,status,current_step,steps,started,ended";
const REQUEST_FIELDS =
  "id,ref,title,description,caller_id_friendlyname,org_id_friendlyname,service_name,servicesubcategory_name,start_date";
/** approve.php, as compiled into iTop's production environment. */
export const APPROVE_SCRIPT = "env-production/approval-base/approve.php";
/** Most ongoing approvals read to find the caller's (all of them, in practice). */
const ONGOING_LIMIT = 500;
/** How far back, and how many, "decided by me" looks. */
const DECIDED_DAYS = 90;
const DECIDED_SCAN = 200;
const DECIDED_LIMIT = 50;

const STATUS: Record<string, ApprovalStatus> = { ongoing: "pending", accepted: "approved", rejected: "rejected" };

interface RawApprover {
  class: string;
  id: number;
  passcode: string;
  approval?: boolean;
  /** Unix seconds. */
  answerTime?: number;
  comment: string;
  forward: RawApprover[];
  /** Which substitute answered, when one did. */
  replierIndex?: number;
}

interface RawStep {
  status: string;
  approved?: boolean;
  approvers: RawApprover[];
}

interface Scheme {
  id: number;
  objClass: string;
  objKey: number;
  status: ApprovalStatus;
  currentStep: number;
  steps: RawStep[];
  started: string;
  ended: string;
}

const obj = (value: PhpValue | undefined): Record<string, PhpValue> =>
  value && typeof value === "object" ? value : {};
const num = (value: PhpValue | undefined): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function toApprover(value: PhpValue): RawApprover {
  const a = obj(value);
  const approval = a["approval"];
  const answerTime = num(a["answer_time"]);
  const replierIndex = num(a["replier_index"]);
  return {
    class: str(a["class"]),
    id: num(a["id"]) ?? 0,
    passcode: str(a["passcode"]),
    ...(typeof approval === "boolean" ? { approval } : {}),
    ...(answerTime !== undefined ? { answerTime } : {}),
    comment: str(a["comment"]),
    forward: phpList(a["forward"]).map(toApprover),
    ...(replierIndex !== undefined ? { replierIndex } : {}),
  };
}

/** The steps text of an ApprovalScheme. */
export function parseSteps(text: string): RawStep[] {
  if (!text.trim()) return [];
  return phpList(phpUnserialize(text)).map((value) => {
    const s = obj(value);
    const approved = s["approved"];
    return {
      status: str(s["status"]),
      ...(typeof approved === "boolean" ? { approved } : {}),
      approvers: phpList(s["approvers"]).map(toApprover),
    };
  });
}

/** Approvers are Persons; the caller is matched on the Person linked to their account. */
const isContact = (a: { class: string; id: number }, contactId: number) =>
  contactId > 0 && a.id === contactId && (a.class === "Person" || a.class === "Contact");

/** The caller's place in the running level, while their answer is awaited. */
function awaited(scheme: Scheme, contactId: number): { approver: RawApprover; passcode: string } | null {
  if (scheme.status !== "pending") return null;
  const step = scheme.steps[scheme.currentStep];
  if (!step) return null;
  for (const approver of step.approvers) {
    if (approver.answerTime !== undefined) continue;
    if (isContact(approver, contactId)) return { approver, passcode: approver.passcode };
    const substitute = approver.forward.find((f) => isContact(f, contactId));
    if (substitute) return { approver, passcode: substitute.passcode };
  }
  return null;
}

/** Whether the caller answered this approver slot (themselves, or as the substitute who replied). */
function answeredBy(approver: RawApprover, contactId: number): boolean {
  if (approver.answerTime === undefined) return false;
  if (approver.replierIndex !== undefined) {
    const replier = approver.forward[approver.replierIndex];
    return replier ? isContact(replier, contactId) : false;
  }
  return isContact(approver, contactId);
}

function myAnswer(scheme: Scheme, contactId: number): ApprovalSummary["myAnswer"] {
  let found: ApprovalSummary["myAnswer"] = null;
  for (const step of scheme.steps) {
    for (const approver of step.approvers) {
      if (answeredBy(approver, contactId) && approver.approval !== undefined) {
        found = {
          decision: approver.approval ? "approved" : "rejected",
          comment: approver.comment,
          at: unixToIso(approver.answerTime),
        };
      }
    }
  }
  return found;
}

/** Listed anywhere in the scheme, as an approver or a substitute. */
function involved(scheme: Scheme, contactId: number): boolean {
  return scheme.steps.some((step) =>
    step.approvers.some((a) => isContact(a, contactId) || a.forward.some((f) => isContact(f, contactId))),
  );
}

const unixToIso = (seconds: number | undefined) =>
  seconds === undefined ? "" : new Date(seconds * 1000).toISOString();

function stepStatus(step: RawStep): ApprovalLevel["status"] {
  if (step.status === "ongoing") return "in_progress";
  if (step.status === "done") return step.approved ? "approved" : "rejected";
  return "waiting";
}

/** Strips the markup iTop's pages wrap their messages in. */
function pageText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return plain(body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).replace(/\s+/g, " ").trim().slice(0, 300);
}

export class ApprovalsService {
  constructor(
    private readonly client: ItopClient,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private contactId(): number {
    return currentCaller()?.contactId ?? 0;
  }

  private toScheme(row: FlatObject): Scheme {
    const f = row.fields;
    return {
      id: row.id,
      objClass: str(f["obj_class"]),
      objKey: Number(f["obj_key"]) || 0,
      status: STATUS[str(f["status"])] ?? "pending",
      currentStep: Number(f["current_step"]) || 0,
      steps: parseSteps(str(f["steps"])),
      started: itopTimeToIso(str(f["started"]), this.timeZone),
      ended: itopTimeToIso(str(f["ended"]), this.timeZone),
    };
  }

  private async schemes(oql: string, limit: number, page = 1): Promise<{ rows: FlatObject[]; total: number }> {
    const result = await this.client.call(
      "core/get",
      { class: "ApprovalScheme", key: oql, output_fields: SCHEME_FIELDS, limit, page },
      { asService: true },
    );
    return { rows: normalizeObjects(result.objects), total: parseFoundCount(result.message) ?? 0 };
  }

  private async scheme(id: number): Promise<Scheme | null> {
    const { rows } = await this.schemes(`SELECT ApprovalScheme WHERE id = ${id} AND obj_class = '${APPROVED_CLASS}'`, 1);
    return rows[0] ? this.toScheme(rows[0]) : null;
  }

  private async ongoing(): Promise<Scheme[]> {
    const { rows } = await this.schemes(
      `SELECT ApprovalScheme WHERE status = 'ongoing' AND obj_class = '${APPROVED_CLASS}'`,
      ONGOING_LIMIT,
    );
    return rows.map((row) => this.toScheme(row));
  }

  private async requests(ids: number[]): Promise<Map<number, FlatObject>> {
    const unique = [...new Set(ids)].filter((id) => id > 0);
    if (unique.length === 0) return new Map();
    const result = await this.client.call(
      "core/get",
      {
        class: APPROVED_CLASS,
        key: `SELECT ${APPROVED_CLASS} WHERE id IN (${unique.join(",")})`,
        output_fields: REQUEST_FIELDS,
        limit: unique.length,
      },
      { asService: true },
    );
    return new Map(normalizeObjects(result.objects).map((row) => [row.id, row]));
  }

  private async names(schemes: Scheme[]): Promise<Map<number, string>> {
    const ids = new Set<number>();
    for (const s of schemes) {
      for (const step of s.steps) {
        for (const a of step.approvers) {
          ids.add(a.id);
          for (const f of a.forward) ids.add(f.id);
        }
      }
    }
    const list = [...ids].filter((id) => id > 0);
    if (list.length === 0) return new Map();
    const result = await this.client.call(
      "core/get",
      { class: "Contact", key: `SELECT Contact WHERE id IN (${list.join(",")})`, output_fields: "friendlyname", limit: list.length },
      { asService: true },
    );
    return new Map(normalizeObjects(result.objects).map((row) => [row.id, str(row.fields["friendlyname"])]));
  }

  private requestInfo(scheme: Scheme, row: FlatObject | undefined): ApprovalRequestInfo {
    const f = row?.fields ?? {};
    return {
      id: scheme.objKey,
      ref: str(f["ref"]),
      title: str(f["title"]),
      requester: str(f["caller_id_friendlyname"]),
      organization: str(f["org_id_friendlyname"]),
      service: str(f["service_name"]),
      subcategory: str(f["servicesubcategory_name"]),
      createdAt: itopTimeToIso(str(f["start_date"]), this.timeZone),
    };
  }

  private summary(scheme: Scheme, request: FlatObject | undefined, contactId: number): ApprovalSummary {
    return {
      id: scheme.id,
      status: scheme.status,
      awaitingMe: awaited(scheme, contactId) !== null,
      myAnswer: myAnswer(scheme, contactId),
      level: Math.min(scheme.currentStep + 1, Math.max(scheme.steps.length, 1)),
      levels: scheme.steps.length,
      startedAt: scheme.started,
      endedAt: scheme.ended,
      request: this.requestInfo(scheme, request),
    };
  }

  private levels(scheme: Scheme, names: Map<number, string>): ApprovalLevel[] {
    const name = (a: { id: number }) => names.get(a.id) ?? `#${a.id}`;
    return scheme.steps.map((step, index) => ({
      level: index + 1,
      status: stepStatus(step),
      approvers: step.approvers.map(
        (a): ApprovalAnswer => {
          const replier = a.replierIndex !== undefined ? a.forward[a.replierIndex] : undefined;
          return {
            name: name(a),
            decision: a.approval === undefined ? null : a.approval ? "approved" : "rejected",
            comment: a.comment,
            at: unixToIso(a.answerTime),
            answeredBy: replier ? name(replier) : "",
          };
        },
      ),
    }));
  }

  /** Approvals waiting for the caller, or the ones they answered lately. */
  async list(state: "pending" | "decided"): Promise<ApprovalList> {
    const contactId = this.contactId();
    if (contactId <= 0) return { items: [], pending: 0 };
    const since = new Date(this.now().getTime() - DECIDED_DAYS * 86_400_000);
    const decidedOql =
      `SELECT ApprovalScheme WHERE obj_class = '${APPROVED_CLASS}' ` +
      `AND started >= '${toItopTime(since, this.timeZone)}'`;
    // Independent reads: in parallel, since each is a full iTop round trip.
    const [ongoing, decided] = await Promise.all([
      this.ongoing(),
      state === "decided"
        ? newestRows(DECIDED_SCAN, (page, size) => this.schemes(decidedOql, size, page))
        : Promise.resolve(null),
    ]);
    const mine = ongoing.filter((s) => awaited(s, contactId));
    let shown: Scheme[];
    if (!decided) {
      shown = mine;
    } else {
      shown = decided.rows
        .map((row) => this.toScheme(row))
        .filter((s) => myAnswer(s, contactId) !== null)
        .slice(0, DECIDED_LIMIT);
    }
    const requests = await this.requests(shown.map((s) => s.objKey));
    const items = shown
      .map((s) => this.summary(s, requests.get(s.objKey), contactId))
      .sort((a, b) =>
        state === "pending"
          ? a.startedAt.localeCompare(b.startedAt)
          : (b.myAnswer?.at ?? "").localeCompare(a.myAnswer?.at ?? ""),
      );
    return { items, pending: mine.length };
  }

  /** How many approvals wait for the caller: the badge. */
  async pendingCount(): Promise<number> {
    const contactId = this.contactId();
    if (contactId <= 0) return 0;
    return (await this.ongoing()).filter((s) => awaited(s, contactId)).length;
  }

  /** One approval the caller is an approver on; 404 for any other. */
  async get(id: number): Promise<ApprovalDetail> {
    const contactId = this.contactId();
    const scheme = contactId > 0 ? await this.scheme(id) : null;
    if (!scheme || !involved(scheme, contactId)) throw notFound(`No approval ${id}.`);
    return this.detail(scheme, contactId);
  }

  private async detail(scheme: Scheme, contactId: number): Promise<ApprovalDetail> {
    const [requests, names] = await Promise.all([this.requests([scheme.objKey]), this.names([scheme])]);
    const request = requests.get(scheme.objKey);
    return {
      ...this.summary(scheme, request, contactId),
      description: plain(str(request?.fields["description"])),
      steps: this.levels(scheme, names),
    };
  }

  /**
   * Records the caller's answer, as iTop's own approval page does. A
   * rejection needs a comment (the extension refuses one without).
   */
  async answer(id: number, decision: ApprovalDecision, comment: string): Promise<ApprovalDetail> {
    const contactId = this.contactId();
    const text = comment.trim();
    if (decision === "rejected" && !text) throw badRequest("Say why you reject it: a comment is required.");
    const scheme = contactId > 0 ? await this.scheme(id) : null;
    if (!scheme || !involved(scheme, contactId)) throw notFound(`No approval ${id}.`);
    const slot = awaited(scheme, contactId);
    if (!slot) {
      throw new AppError(
        "conflict",
        scheme.status === "pending"
          ? "Your answer is not awaited on this approval any more."
          : `This approval is already ${scheme.status}.`,
      );
    }

    // The approver's own token: approve.php identifies a substitute by the
    // substitute's contact and passcode.
    const token = [scheme.id, scheme.currentStep, "Person", contactId, slot.passcode].join("-");
    const response = await this.client.postScript(
      APPROVE_SCRIPT,
      { operation: decision === "approved" ? "do_approve" : "do_reject", token, comment: text },
      { asService: true },
    );
    const page = await response.text();

    const after = await this.scheme(id);
    const recorded = after?.steps[scheme.currentStep]?.approvers.some((a) => answeredBy(a, contactId));
    if (!after || !recorded) {
      throw new AppError("upstream_error", `iTop did not record the answer: ${pageText(page) || "no reason given"}`);
    }
    return this.detail(after, contactId);
  }

  /** The approval on one request (the newest, if it went through several), or null. */
  async forRequest(requestId: number): Promise<RecordApproval | null> {
    const { rows } = await this.schemes(
      `SELECT ApprovalScheme WHERE obj_class = '${APPROVED_CLASS}' AND obj_key = ${requestId}`,
      20,
    );
    const newest = rows.sort((a, b) => b.id - a.id)[0];
    if (!newest) return null;
    const scheme = this.toScheme(newest);
    const names = await this.names([scheme]);
    return {
      id: scheme.id,
      status: scheme.status,
      startedAt: scheme.started,
      endedAt: scheme.ended,
      steps: this.levels(scheme, names),
    };
  }
}
