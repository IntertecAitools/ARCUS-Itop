import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant, type Caller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { likeContains } from "../../itop/oql.js";
import type { ObjectDto } from "../../platform/objects/objects.service.js";
import type { DocStore, StoredDoc } from "../../shared/doc-store.js";
import { addDays, itopDay } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import type {
  ArticleAction,
  ArticleActionInput,
  ArticleDetail,
  ArticleEvent,
  ArticleFeedback,
  ArticleKind,
  ArticleList,
  ArticleListQuery,
  ArticleState,
  ArticleSummary,
  FeedbackInput,
  Helpfulness,
  KnowledgeSettings,
} from "./knowledge.types.js";

const ARTICLE_KIND = "kb-article";
const FEEDBACK_KIND = "kb-feedback";
const SETTINGS_KIND = "kb-settings";

export const DEFAULT_KNOWLEDGE_SETTINGS = { reviewerProfiles: ["Document author"], reviewIntervalDays: 180 };

/** Articles of each kind a list reads at most. */
const LIST_CAP = 500;
/** History entries kept per article. */
const HISTORY_CAP = 100;

const CLASS_OF: Record<ArticleKind, string> = { faq: "FAQ", known_error: "KnownError" };
const KIND_OF: Record<string, ArticleKind> = { FAQ: "faq", KnownError: "known_error" };

const LIST_FIELDS: Record<ArticleKind, string> = {
  faq: "title,summary,category_name",
  known_error: "name,symptom,domain",
};
const DETAIL_FIELDS: Record<ArticleKind, string> = {
  faq: "title,summary,description,category_name",
  known_error: "name,symptom,domain,root_cause,workaround,solution",
};

/** Which state each action leaves from, and goes to. */
const MOVES: Record<ArticleAction, { from: ArticleState; to: ArticleState; reviewer: boolean }> = {
  submit: { from: "draft", to: "in_review", reviewer: false },
  approve: { from: "in_review", to: "published", reviewer: true },
  send_back: { from: "in_review", to: "draft", reviewer: true },
  reviewed: { from: "published", to: "published", reviewer: true },
  retire: { from: "published", to: "retired", reviewer: true },
  restore: { from: "retired", to: "draft", reviewer: true },
};

interface ArticleDoc {
  state: ArticleState;
  author: string;
  reviewDue: string;
  history: ArticleEvent[];
  helpful: { yes: number; no: number };
}

interface FeedbackDoc {
  helpful: boolean;
  comment: string;
  by: string;
  source: "portal" | "staff";
}

/** The workflow's view of an article it never saw: published, as it always was. */
const LEGACY: ArticleDoc = { state: "published", author: "", reviewDue: "", history: [], helpful: { yes: 0, no: 0 } };

const keyOf = (kind: ArticleKind, id: number | string) => `${kind}:${id}`;

const helpfulness = (h: { yes: number; no: number }): Helpfulness => ({
  yes: h.yes,
  no: h.no,
  score: h.yes + h.no > 0 ? Math.round((100 * h.yes) / (h.yes + h.no)) : null,
});

/** Who said it: the person's name, or the login. */
const who = (caller: Caller | undefined) => caller?.name || caller?.login || "";

/**
 * Knowledge articles on iTop's FAQ and KnownError records, with the editorial
 * workflow iTop lacks: authors draft and submit, a reviewer (a configured
 * profile, or an administrator) approves or sends back with comments,
 * published articles are reviewed again by a due date and can be retired.
 * The state, history and readers' "was this helpful?" votes are kept in the
 * BFF's own database. Only published FAQs reach the portal.
 */
export class KnowledgeService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: DocStore,
    private readonly timeZone: string,
  ) {}

  private tenant(): string {
    return currentTenant()?.id ?? "";
  }

  private today(): string {
    return itopDay(new Date(), this.timeZone);
  }

  /* --------------------------------------------------------------------- *
   * Settings and rights
   * --------------------------------------------------------------------- */

  async getSettings(): Promise<KnowledgeSettings> {
    const stored = await this.store.get<typeof DEFAULT_KNOWLEDGE_SETTINGS>(this.tenant(), SETTINGS_KIND, "settings");
    return {
      ...structuredClone(DEFAULT_KNOWLEDGE_SETTINGS),
      ...(stored?.body ?? {}),
      updatedAt: stored?.updatedAt ?? "",
      updatedBy: stored?.updatedBy ?? "",
    };
  }

  async saveSettings(input: { reviewerProfiles: string[]; reviewIntervalDays: number }): Promise<KnowledgeSettings> {
    const reviewerProfiles = [...new Set(input.reviewerProfiles.map((p) => p.trim()).filter(Boolean))];
    await this.store.put(
      this.tenant(),
      SETTINGS_KIND,
      "settings",
      { reviewerProfiles, reviewIntervalDays: input.reviewIntervalDays },
      currentCaller()?.login ?? "",
    );
    return this.getSettings();
  }

  /** Without sign-in (development) the BFF acts as its own administrator. */
  private canReview(settings: KnowledgeSettings): boolean {
    const caller = currentCaller();
    return !caller || caller.isAdmin || caller.profiles.some((p) => settings.reviewerProfiles.includes(p));
  }

  /* --------------------------------------------------------------------- *
   * Workflow documents
   * --------------------------------------------------------------------- */

  private async doc(kind: ArticleKind, id: number): Promise<ArticleDoc> {
    const stored = await this.store.get<ArticleDoc>(this.tenant(), ARTICLE_KIND, keyOf(kind, id));
    return stored ? { ...structuredClone(LEGACY), ...stored.body } : structuredClone(LEGACY);
  }

  private async docs(): Promise<Map<string, ArticleDoc>> {
    const all = await this.store.list<ArticleDoc>(this.tenant(), ARTICLE_KIND);
    return new Map(all.map((d) => [d.key, { ...structuredClone(LEGACY), ...d.body }]));
  }

  private event(action: ArticleEvent["action"], comment = ""): ArticleEvent {
    return { at: new Date().toISOString(), by: who(currentCaller()), action, comment: comment.trim() };
  }

  private async putDoc(kind: ArticleKind, id: number, doc: ArticleDoc): Promise<void> {
    doc.history = doc.history.slice(-HISTORY_CAP);
    await this.store.put(this.tenant(), ARTICLE_KIND, keyOf(kind, id), doc, currentCaller()?.login ?? "");
  }

  /**
   * ObjectsService calls this after any record is created: a new FAQ or
   * known error starts as its author's draft, whichever screen made it.
   */
  async onCreate(className: string, created: ObjectDto): Promise<boolean> {
    const kind = KIND_OF[className];
    if (!kind) return false;
    await this.putDoc(kind, created.id, {
      state: "draft",
      author: currentCaller()?.login ?? "",
      reviewDue: "",
      history: [this.event("created")],
      helpful: { yes: 0, no: 0 },
    });
    return false;
  }

  /* --------------------------------------------------------------------- *
   * Reading articles
   * --------------------------------------------------------------------- */

  private summary(kind: ArticleKind, row: FlatObject, doc: ArticleDoc): ArticleSummary {
    const f = row.fields;
    const today = this.today();
    return {
      kind,
      id: String(row.id),
      title: str(kind === "faq" ? f["title"] : f["name"]),
      summary: str(kind === "faq" ? f["summary"] : f["symptom"]),
      category: str(kind === "faq" ? f["category_name"] : f["domain"]),
      state: doc.state,
      author: doc.author,
      reviewDue: doc.state === "published" ? doc.reviewDue : "",
      reviewOverdue: doc.state === "published" && !!doc.reviewDue && doc.reviewDue <= today,
      helpfulness: helpfulness(doc.helpful),
    };
  }

  private async rows(kind: ArticleKind, q?: string): Promise<FlatObject[]> {
    const term = q?.trim();
    const cls = CLASS_OF[kind];
    const fields = kind === "faq" ? ["title", "summary", "key_words"] : ["name", "symptom", "error_code"];
    const where = term ? ` WHERE ${fields.map((f) => `${f} LIKE ${likeContains(term)}`).join(" OR ")}` : "";
    const result = await this.client.call("core/get", {
      class: cls,
      key: `SELECT ${cls}${where}`,
      output_fields: LIST_FIELDS[kind],
      limit: LIST_CAP,
      page: 1,
    });
    return normalizeObjects(result.objects);
  }

  async list(query: ArticleListQuery = {}): Promise<ArticleList> {
    const kinds: ArticleKind[] = query.kind ? [query.kind] : ["faq", "known_error"];
    const [rowsByKind, docs, settings] = await Promise.all([
      Promise.all(kinds.map(async (kind) => ({ kind, rows: await this.rows(kind, query.q) }))),
      this.docs(),
      this.getSettings(),
    ]);
    const all = rowsByKind.flatMap(({ kind, rows }) =>
      rows.map((row) => this.summary(kind, row, docs.get(keyOf(kind, row.id)) ?? LEGACY)),
    );
    const counts = { draft: 0, in_review: 0, published: 0, retired: 0, review_due: 0 };
    for (const a of all) {
      counts[a.state] += 1;
      if (a.reviewOverdue) counts.review_due += 1;
    }
    const items = all
      .filter((a) => !query.state || (query.state === "review_due" ? a.reviewOverdue : a.state === query.state))
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return { items, counts, canReview: this.canReview(settings) };
  }

  private async row(kind: ArticleKind, id: number, asService = false): Promise<FlatObject> {
    const result = await this.client.call(
      "core/get",
      { class: CLASS_OF[kind], key: id, output_fields: DETAIL_FIELDS[kind] },
      asService ? { asService: true } : undefined,
    );
    const row = normalizeObjects(result.objects)[0];
    if (!row) throw notFound(`That ${kind === "faq" ? "FAQ" : "known error"} was not found.`);
    return row;
  }

  private sections(kind: ArticleKind, row: FlatObject): ArticleDetail["sections"] {
    const f = row.fields;
    const parts: Array<[string, string, boolean]> =
      kind === "faq"
        ? [["Summary", "summary", false], ["Answer", "description", true]]
        : [["Symptom", "symptom", false], ["Root cause", "root_cause", false], ["Workaround", "workaround", false], ["Solution", "solution", false]];
    return parts
      .map(([label, code, html]) => ({ label, text: str(f[code]), html }))
      .filter((s) => s.text.trim() !== "");
  }

  private async feedbackOf(kind: ArticleKind, id: number): Promise<Array<StoredDoc<FeedbackDoc>>> {
    return this.store.list<FeedbackDoc>(this.tenant(), FEEDBACK_KIND, `${keyOf(kind, id)}/`);
  }

  async get(kind: ArticleKind, id: number): Promise<ArticleDetail> {
    const [row, doc, settings, feedback] = await Promise.all([
      this.row(kind, id),
      this.doc(kind, id),
      this.getSettings(),
      this.feedbackOf(kind, id),
    ]);
    const caller = currentCaller();
    const reviewer = this.canReview(settings);
    const mine = caller ? feedback.find((f) => f.key === `${keyOf(kind, id)}/${caller.login}`) : undefined;
    return {
      ...this.summary(kind, row, doc),
      recordClass: CLASS_OF[kind],
      sections: this.sections(kind, row),
      history: [...doc.history].reverse(),
      feedback: feedback
        .map((f) => ({ ...f.body, at: f.updatedAt }) satisfies ArticleFeedback)
        .sort((a, b) => b.at.localeCompare(a.at)),
      actions: (Object.keys(MOVES) as ArticleAction[]).filter((action) => {
        const move = MOVES[action];
        return move.from === doc.state && (!move.reviewer || reviewer);
      }),
      myFeedback: mine ? { helpful: mine.body.helpful, comment: mine.body.comment } : null,
    };
  }

  /* --------------------------------------------------------------------- *
   * The workflow
   * --------------------------------------------------------------------- */

  async act(kind: ArticleKind, id: number, input: ArticleActionInput): Promise<ArticleDetail> {
    await this.row(kind, id); // exists, and the caller can see it
    const [doc, settings] = await Promise.all([this.doc(kind, id), this.getSettings()]);
    const move = MOVES[input.action];
    if (doc.state !== move.from) {
      throw new AppError("conflict", `The article is ${doc.state.replace("_", " ")}: it cannot be ${input.action.replace("_", " ")}.`, {
        details: { reason: "wrong_state", state: doc.state },
      });
    }
    if (move.reviewer && !this.canReview(settings)) {
      throw new AppError("forbidden", `Only a reviewer (${settings.reviewerProfiles.join(", ") || "an administrator"}) may do that.`);
    }
    const caller = currentCaller();
    if (input.action === "approve" && caller && !caller.isAdmin && doc.author === caller.login) {
      throw new AppError("forbidden", "Another reviewer approves your own article.", { details: { reason: "own_article" } });
    }
    if (input.action === "send_back" && !input.comment.trim()) {
      throw badRequest("Say what to change: a comment is needed to send the article back.");
    }
    let reviewDue = doc.reviewDue;
    if (input.action === "approve" || input.action === "reviewed") {
      reviewDue = input.reviewDue || addDays(this.today(), settings.reviewIntervalDays);
      if (reviewDue <= this.today()) throw badRequest("The next review date must be in the future.");
    }
    await this.putDoc(kind, id, {
      ...doc,
      state: move.to,
      // Whoever submits is the author the reviewer answers to.
      author: input.action === "submit" ? (caller?.login ?? doc.author) : doc.author,
      reviewDue: move.to === "published" ? reviewDue : "",
      history: [...doc.history, this.event(input.action, input.comment)],
    });
    return this.get(kind, id);
  }

  /* --------------------------------------------------------------------- *
   * Feedback
   * --------------------------------------------------------------------- */

  /**
   * One vote per person and article (a second one replaces the first), on
   * published articles only. The article's tally is recounted from the votes.
   */
  async feedback(kind: ArticleKind, id: number, input: FeedbackInput, source: "portal" | "staff"): Promise<Helpfulness> {
    const caller = currentCaller();
    if (!caller) throw new AppError("unauthorized", "Sign in to rate an article.");
    await this.row(kind, id, source === "portal");
    const doc = await this.doc(kind, id);
    if (doc.state !== "published") throw notFound("That article is not published.");
    const tenant = this.tenant();
    await this.store.put<FeedbackDoc>(
      tenant,
      FEEDBACK_KIND,
      `${keyOf(kind, id)}/${caller.login}`,
      { helpful: input.helpful, comment: input.comment.trim(), by: who(caller), source },
      caller.login,
    );
    const votes = await this.feedbackOf(kind, id);
    doc.helpful = {
      yes: votes.filter((v) => v.body.helpful).length,
      no: votes.filter((v) => !v.body.helpful).length,
    };
    await this.store.put(tenant, ARTICLE_KIND, keyOf(kind, id), doc, caller.login);
    return helpfulness(doc.helpful);
  }

  /** The FAQs among `ids` the portal may show: published ones (or ones the workflow never saw). */
  async publishedFaqs(ids: number[]): Promise<Set<number>> {
    const hidden = new Set(
      (await this.store.list<ArticleDoc>(this.tenant(), ARTICLE_KIND, "faq:"))
        .filter((d) => d.body.state !== "published")
        .map((d) => Number(d.key.slice(4))),
    );
    return new Set(ids.filter((id) => !hidden.has(id)));
  }
}
