import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import { KnowledgeService } from "../src/modules/knowledge/index.js";
import { PortalService } from "../src/platform/portal/portal.service.js";
import { MemoryDocStore } from "../src/shared/doc-store.js";
import { FakeItopClient, getResponse } from "./helpers.js";

const TZ = "Europe/Paris";

const person = (login: string, profiles: string[], isAdmin = false, kind: Caller["kind"] = "staff"): Caller => ({
  userId: login.length,
  login,
  contactId: 40 + login.length,
  name: login.toUpperCase(),
  kind,
  profiles,
  isAdmin,
  allowedOrgIds: [],
  orgId: 1,
  email: "",
});
const author = person("kb.author", ["Support Agent"]);
const reviewer = person("kb.reviewer", ["Document author"]);
const endUser = person("kb.reader", ["Portal user"], false, "portal");

const FAQS = [
  { class: "FAQ", id: 1, fields: { title: "Reset your password", summary: "Use the portal", description: "<p>Steps</p>", category_name: "Accounts" } },
  { class: "FAQ", id: 2, fields: { title: "Map a printer", summary: "Printers", description: "", category_name: "Printing" } },
];

function itop() {
  return new FakeItopClient().on("core/get", (params) => {
    if (params["class"] === "KnownError") {
      return getResponse([{ class: "KnownError", id: 5, fields: { name: "VPN drops", symptom: "Disconnects", domain: "Network", root_cause: "MTU", workaround: "", solution: "" } }]);
    }
    const key = params["key"];
    if (typeof key === "number") return getResponse(FAQS.filter((f) => f.id === key));
    return getResponse(FAQS);
  });
}

const forbidden = (e: unknown) => e instanceof AppError && e.code === "forbidden";

describe("KnowledgeService workflow", () => {
  it("treats articles it never saw as published, and new ones as their author's draft", async () => {
    const kb = new KnowledgeService(itop().asClient(), new MemoryDocStore(), TZ);
    await runAs(author, () => kb.onCreate("FAQ", { class: "FAQ", id: 2, label: "", fields: {} }));
    assert.equal(await kb.onCreate("UserRequest", { class: "UserRequest", id: 9, label: "", fields: {} }), false);

    const list = await runAs(author, () => kb.list());
    const states = Object.fromEntries(list.items.map((a) => [`${a.kind}:${a.id}`, a.state]));
    assert.deepEqual(states, { "faq:1": "published", "faq:2": "draft", "known_error:5": "published" });
    assert.equal(list.counts.draft, 1);
    assert.equal(list.canReview, false);
    assert.deepEqual((await runAs(author, () => kb.list({ state: "draft" }))).items.map((a) => a.id), ["2"]);

    const draft = await runAs(author, () => kb.get("faq", 2));
    assert.equal(draft.author, "kb.author");
    assert.deepEqual(draft.actions, ["submit"]);
    assert.deepEqual(draft.history.map((h) => h.action), ["created"]);
  });

  it("goes draft -> review -> back with comments -> review -> published -> retired", async () => {
    const kb = new KnowledgeService(itop().asClient(), new MemoryDocStore(), TZ);
    await runAs(author, () => kb.onCreate("FAQ", { class: "FAQ", id: 2, label: "", fields: {} }));

    await runAs(author, () => kb.act("faq", 2, { action: "submit", comment: "" }));
    await assert.rejects(runAs(author, () => kb.act("faq", 2, { action: "approve", comment: "" })), forbidden);
    await assert.rejects(runAs(reviewer, () => kb.act("faq", 2, { action: "send_back", comment: " " })), /comment is needed/);
    const back = await runAs(reviewer, () => kb.act("faq", 2, { action: "send_back", comment: "Add a screenshot" }));
    assert.equal(back.state, "draft");

    await runAs(author, () => kb.act("faq", 2, { action: "submit", comment: "Done" }));
    const inReview = await runAs(reviewer, () => kb.get("faq", 2));
    assert.deepEqual(inReview.actions, ["approve", "send_back"]);
    await assert.rejects(runAs(reviewer, () => kb.act("faq", 2, { action: "approve", comment: "", reviewDue: "2020-01-01" })), /future/);
    const published = await runAs(reviewer, () => kb.act("faq", 2, { action: "approve", comment: "" }));
    assert.equal(published.state, "published");
    assert.match(published.reviewDue, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(published.reviewOverdue, false);
    assert.deepEqual(
      published.history.map((h) => h.action),
      ["approve", "submit", "send_back", "submit", "created"],
    );

    await assert.rejects(
      runAs(reviewer, () => kb.act("faq", 2, { action: "submit", comment: "" })),
      (e: unknown) => e instanceof AppError && e.code === "conflict",
    );
    const retired = await runAs(reviewer, () => kb.act("faq", 2, { action: "retire", comment: "Superseded" }));
    assert.equal(retired.state, "retired");
    assert.equal(retired.reviewDue, "");
  });

  it("does not let a reviewer approve their own article, unless an administrator", async () => {
    const kb = new KnowledgeService(itop().asClient(), new MemoryDocStore(), TZ);
    await runAs(reviewer, () => kb.onCreate("FAQ", { class: "FAQ", id: 2, label: "", fields: {} }));
    await runAs(reviewer, () => kb.act("faq", 2, { action: "submit", comment: "" }));
    await assert.rejects(runAs(reviewer, () => kb.act("faq", 2, { action: "approve", comment: "" })), /Another reviewer/);
    const admin = person("admin", ["Administrator"], true);
    assert.equal((await runAs(admin, () => kb.act("faq", 2, { action: "approve", comment: "" }))).state, "published");
  });

  it("follows the configured reviewer profiles", async () => {
    const kb = new KnowledgeService(itop().asClient(), new MemoryDocStore(), TZ);
    const settings = await kb.saveSettings({ reviewerProfiles: ["Support Agent", " ", "Support Agent"], reviewIntervalDays: 30 });
    assert.deepEqual(settings.reviewerProfiles, ["Support Agent"]);
    assert.equal((await runAs(author, () => kb.list())).canReview, true);
    assert.equal((await runAs(reviewer, () => kb.list())).canReview, false);
  });

  it("lists published articles past their review date as review due", async () => {
    const store = new MemoryDocStore();
    const kb = new KnowledgeService(itop().asClient(), store, TZ);
    await store.put("", "kb-article", "faq:1", { state: "published", author: "x", reviewDue: "2026-01-01", history: [], helpful: { yes: 0, no: 0 } }, "x");
    const due = await runAs(reviewer, () => kb.list({ state: "review_due" }));
    assert.deepEqual(due.items.map((a) => a.id), ["1"]);
    assert.equal(due.counts.review_due, 1);
    const reviewed = await runAs(reviewer, () => kb.act("faq", 1, { action: "reviewed", comment: "Still right" }));
    assert.equal(reviewed.reviewOverdue, false);
  });
});

describe("KnowledgeService feedback", () => {
  it("keeps one vote per person, recounts the score, and lists the comments for authors", async () => {
    const kb = new KnowledgeService(itop().asClient(), new MemoryDocStore(), TZ);
    assert.deepEqual(await runAs(endUser, () => kb.feedback("faq", 1, { helpful: false, comment: "Outdated" }, "portal")), {
      yes: 0,
      no: 1,
      score: 0,
    });
    await runAs(endUser, () => kb.feedback("faq", 1, { helpful: true, comment: "" }, "portal"));
    const score = await runAs(author, () => kb.feedback("faq", 1, { helpful: true, comment: "Clear" }, "staff"));
    assert.deepEqual(score, { yes: 2, no: 0, score: 100 });

    const detail = await runAs(author, () => kb.get("faq", 1));
    assert.equal(detail.feedback.length, 2);
    assert.deepEqual(detail.myFeedback, { helpful: true, comment: "Clear" });
    assert.deepEqual(new Set(detail.feedback.map((f) => f.source)), new Set(["portal", "staff"]));
    assert.equal((await runAs(author, () => kb.list())).items.find((a) => a.id === "1")?.helpfulness.score, 100);
  });

  it("takes votes on published articles only", async () => {
    const kb = new KnowledgeService(itop().asClient(), new MemoryDocStore(), TZ);
    await runAs(author, () => kb.onCreate("FAQ", { class: "FAQ", id: 2, label: "", fields: {} }));
    await assert.rejects(runAs(endUser, () => kb.feedback("faq", 2, { helpful: true, comment: "" }, "portal")), /not published/);
  });
});

describe("portal FAQs", () => {
  it("shows only published FAQs", async () => {
    const fake = itop();
    const kb = new KnowledgeService(fake.asClient(), new MemoryDocStore(), TZ);
    const portal = new PortalService(fake.asClient(), undefined as never, undefined as never);
    portal.useFaqVisibility((ids) => kb.publishedFaqs(ids));
    await runAs(author, () => kb.onCreate("FAQ", { class: "FAQ", id: 2, label: "", fields: {} }));

    const list = await runAs(endUser, () => portal.faqs());
    assert.deepEqual(list.items.map((f) => f.id), [1]);
    await assert.rejects(runAs(endUser, () => portal.faq(2)), /not found/);
    assert.equal((await runAs(endUser, () => portal.faq(1))).title, "Reset your password");
  });
});
