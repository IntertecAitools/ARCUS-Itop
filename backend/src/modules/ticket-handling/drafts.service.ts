import crypto from "node:crypto";

import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant, type Caller } from "../../core/request-context.js";
import type { DraftStore, StoredDraft } from "./drafts.store.js";
import type { Draft, DraftInput, DraftKind, DraftSummary } from "./ticket-handling.types.js";

/** Kinds each sort of account may keep: staff the staff forms, end users the portal form. */
const KINDS: Record<Caller["kind"], DraftKind[]> = {
  staff: ["incident", "user-request"],
  portal: ["portal-request"],
};

/** Enough for any form; a draft is not an attachment store. */
export const MAX_DRAFT_BYTES = 64 * 1024;
export const MAX_DRAFTS_PER_USER = 50;

const titleOf = (input: DraftInput): string => {
  const given = input.title?.trim();
  if (given) return given.slice(0, 255);
  const fromData = input.data["title"] ?? input.data["summary"];
  return typeof fromData === "string" && fromData.trim() ? fromData.trim().slice(0, 255) : "Untitled draft";
};

/**
 * Server-side drafts of the "new ticket" forms, one list per user. A draft
 * is only ever visible to the account that saved it, in the tenant it was
 * saved in; nothing reaches iTop until the form is submitted.
 */
export class DraftsService {
  constructor(
    private readonly store: DraftStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private owner(): { tenant: string; userId: number; kinds: DraftKind[] } {
    const c = currentCaller();
    // Without sign-in (development) everything is one anonymous owner.
    return {
      tenant: currentTenant()?.id ?? "",
      userId: c?.userId ?? 0,
      kinds: c ? KINDS[c.kind] : [...KINDS.staff, ...KINDS.portal],
    };
  }

  private checkKind(kind: DraftKind, kinds: DraftKind[]): void {
    if (!kinds.includes(kind)) throw new AppError("forbidden", "Your account cannot keep drafts of that form.");
  }

  private static toDraft(d: StoredDraft): Draft {
    const { tenant: _t, userId: _u, ...draft } = d;
    return draft;
  }

  async list(kind?: DraftKind): Promise<DraftSummary[]> {
    const { tenant, userId, kinds } = this.owner();
    if (kind) this.checkKind(kind, kinds);
    const drafts = await this.store.list(tenant, userId, kind);
    return drafts
      .filter((d) => kinds.includes(d.kind))
      .map(({ id, kind: k, title, updatedAt }) => ({ id, kind: k, title, updatedAt }));
  }

  async get(id: string): Promise<Draft> {
    const { tenant, userId, kinds } = this.owner();
    const draft = await this.store.get(tenant, userId, id);
    if (!draft || !kinds.includes(draft.kind)) throw notFound("That draft was not found.");
    return DraftsService.toDraft(draft);
  }

  private checkSize(input: DraftInput): void {
    if (Buffer.byteLength(JSON.stringify(input.data), "utf8") > MAX_DRAFT_BYTES) {
      throw badRequest(`A draft is limited to ${MAX_DRAFT_BYTES / 1024} KB.`);
    }
  }

  async create(input: DraftInput): Promise<Draft> {
    const { tenant, userId, kinds } = this.owner();
    this.checkKind(input.kind, kinds);
    this.checkSize(input);
    if ((await this.store.list(tenant, userId)).length >= MAX_DRAFTS_PER_USER) {
      throw badRequest(`You have ${MAX_DRAFTS_PER_USER} drafts already; delete some first.`);
    }
    const at = this.now().toISOString();
    const draft: StoredDraft = {
      id: crypto.randomBytes(12).toString("hex").slice(0, 24),
      tenant,
      userId,
      kind: input.kind,
      title: titleOf(input),
      data: input.data,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.save(draft);
    return DraftsService.toDraft(draft);
  }

  async update(id: string, input: DraftInput): Promise<Draft> {
    const { tenant, userId, kinds } = this.owner();
    const existing = await this.store.get(tenant, userId, id);
    if (!existing || !kinds.includes(existing.kind)) throw notFound("That draft was not found.");
    if (existing.kind !== input.kind) throw badRequest("A draft keeps the form it was saved from.");
    this.checkSize(input);
    const draft: StoredDraft = { ...existing, title: titleOf(input), data: input.data, updatedAt: this.now().toISOString() };
    await this.store.save(draft);
    return DraftsService.toDraft(draft);
  }

  async remove(id: string): Promise<void> {
    const { tenant, userId } = this.owner();
    if (!(await this.store.get(tenant, userId, id))) throw notFound("That draft was not found.");
    await this.store.remove(tenant, userId, id);
  }
}
