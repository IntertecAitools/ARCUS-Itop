import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { runAs } from "../src/core/request-context.js";
import { ProblemsService } from "../src/modules/problems/index.js";
import {
  AnthropicRcaModel,
  auditEntry,
  buildRcaPrompt,
  parseDraft,
  RCA_DRAFT_SCHEMA,
  redactPersonalData,
  type ModelRequest,
  type RcaContext,
  type RcaModel,
} from "../src/modules/problems/rca-ai.js";
import { cisOf, similarityMatches } from "../src/modules/problems/rca-evidence.js";
import { formatHours, rankCandidates, titleSimilarity, type ScoringInput } from "../src/modules/problems/rca-scoring.js";
import { RcaService } from "../src/modules/problems/rca.service.js";
import type { RcaEvidenceService } from "../src/modules/problems/rca-evidence.js";
import type {
  EvidenceChange,
  EvidenceCi,
  EvidenceIncident,
  RcaEvidence,
} from "../src/modules/problems/problems.types.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import { FakeItopClient } from "./helpers.js";

/* ------------------------------------------------------------------------- *
 * Fixtures: nine incidents, seven of them on SRV-DB-01, and a change on it
 * ------------------------------------------------------------------------- */

const DB = { id: "11", name: "SRV-DB-01" };
const WEB = { id: "12", name: "SRV-WEB-01" };

function incident(n: number, cis = [DB], extra: Partial<EvidenceIncident> = {}): EvidenceIncident {
  return {
    id: String(100 + n),
    ref: `I-${String(100 + n).padStart(6, "0")}`,
    title: "Orders page times out",
    status: "assigned",
    startDate: `2026-10-20T0${n}:00:00.000Z`,
    serviceId: "5",
    serviceName: "Webshop",
    subcategoryId: "9",
    subcategoryName: "Checkout",
    cis,
    ...extra,
  };
}

const incidents = [
  ...[0, 1, 2, 3, 4, 5, 6].map((n) => incident(n)),
  incident(7, [WEB]),
  incident(8, [WEB]),
];

const cis: EvidenceCi[] = [
  { ...DB, class: "DBServer", role: "affected", incidentCount: 7 },
  { ...WEB, class: "Server", role: "affected", incidentCount: 2 },
  { id: "13", name: "SAN-01", class: "StorageSystem", role: "upstream", incidentCount: 0, via: "SRV-DB-01" },
];

function change(extra: Partial<EvidenceChange> = {}): EvidenceChange {
  return {
    id: "123",
    ref: "C-000123",
    title: "Patch database engine",
    class: "NormalChange",
    status: "closed",
    startDate: "2026-10-19T20:00:00.000Z",
    endDate: "2026-10-19T22:00:00.000Z",
    hoursBeforeFirstIncident: 2,
    cis: [{ ...DB, role: "affected" }],
    linkedIncidents: 0,
    relatedToProblem: false,
    ...extra,
  };
}

function scoring(extra: Partial<ScoringInput> = {}): ScoringInput {
  return {
    problemRef: "P-000035",
    problemCiIds: [],
    linkedIncidents: incidents,
    cis,
    changes: [change()],
    problems: [],
    knownErrors: [],
    lookbackHours: 72,
    anchorRef: "I-000100",
    ...extra,
  };
}

function evidence(extra: Partial<RcaEvidence> = {}): RcaEvidence {
  const input = scoring();
  return {
    problemId: "35",
    ref: "P-000035",
    title: "Orders page times out",
    generatedAt: "2026-10-29T10:00:00.000Z",
    lookbackHours: 72,
    anchor: { at: incidents[0]!.startDate, source: "incident", ref: "I-000100" },
    linkedIncidents: incidents,
    similarIncidents: [],
    cis,
    changes: input.changes,
    problems: [],
    knownErrors: [],
    candidates: rankCandidates(input),
    unavailable: [],
    ai: { enabled: true },
    ...extra,
  };
}

/* ------------------------------------------------------------------------- *
 * Scoring
 * ------------------------------------------------------------------------- */

describe("RCA evidence rows", () => {
  it("counts the CIs a ticket names by hand, not the ones iTop computed as impacted", () => {
    assert.deepEqual(
      cisOf([
        { functionalci_id: "11", functionalci_name: "SRV-DB-01", impact_code: "manual" },
        { functionalci_id: "38", functionalci_name: "Shop", impact_code: "computed" },
        { functionalci_id: "11", functionalci_name: "SRV-DB-01", impact_code: "manual" },
      ]),
      [{ id: "11", name: "SRV-DB-01" }],
    );
  });
});

describe("RCA scoring", () => {
  it("puts a change on the common CI, just before the first incident, first, with its reasons", () => {
    const [top, second] = rankCandidates(scoring());
    assert.equal(top!.kind, "change");
    assert.equal(top!.record.label, "C-000123");
    assert.equal(top!.summary, "Change C-000123 on SRV-DB-01, 2h before the first incident");
    assert.deepEqual(
      top!.reasons.map((r) => r.text),
      ["Finished 2h before I-000100", "Touches SRV-DB-01, named by 7 of 9 incidents"],
    );
    // 40 * (1 - 2/72) = 39, 35 * 7/9 = 27
    assert.deepEqual(top!.reasons.map((r) => r.points), [39, 27]);
    assert.equal(top!.score, 66);
    assert.equal(top!.confidence, "medium");
    // The CI itself: 45 * 7/9 = 35, +15 for the change on it; below the change that explains it.
    assert.equal(second!.kind, "ci");
    assert.equal(second!.record.label, "SRV-DB-01");
    assert.equal(second!.score, 50);
  });

  it("gives full timing points to a change still running at the first incident, and the iTop link", () => {
    const [top] = rankCandidates(
      scoring({ changes: [change({ hoursBeforeFirstIncident: -1, relatedToProblem: true })] }),
    );
    assert.equal(top!.reasons[0]!.text, "Was still being implemented when I-000100 opened");
    assert.equal(top!.reasons[0]!.points, 40);
    assert.ok(top!.reasons.some((r) => r.text === "Recorded as the related change of P-000035" && r.points === 25));
    assert.equal(top!.score, 92);
    assert.equal(top!.confidence, "high");
  });

  it("scores a change outside the look-back on its CIs only, and one on an upstream CI lower", () => {
    const late = rankCandidates(scoring({ changes: [change({ hoursBeforeFirstIncident: 100 })] }));
    const lateChange = late.find((c) => c.kind === "change")!;
    assert.equal(lateChange.reasons.length, 1);
    const upstream = rankCandidates(
      scoring({ changes: [change({ cis: [{ id: "13", name: "SAN-01", role: "upstream" }] })] }),
    ).find((c) => c.kind === "change")!;
    assert.equal(upstream.reasons[1]!.text, "Touches SAN-01, which SRV-DB-01 depends on");
    assert.equal(upstream.reasons[1]!.points, 15);
  });

  it("scores known errors and earlier problems on the same CIs, and drops noise", () => {
    const ranked = rankCandidates(
      scoring({
        changes: [],
        knownErrors: [
          { id: "4", name: "DB pool exhaustion", problemRef: "P-000010", rootCause: "Pool too small", workaround: "Restart", cis: [DB] },
        ],
        problems: [
          { id: "10", ref: "P-000010", title: "DB slow", status: "closed", startDate: "", rootCause: "Pool too small", sharedCis: ["SRV-DB-01"], sameService: true },
          { id: "11", ref: "P-000011", title: "Unrelated", status: "closed", startDate: "", rootCause: "", sharedCis: [], sameService: false },
        ],
      }),
    );
    const ke = ranked.find((c) => c.kind === "known_error")!;
    assert.equal(ke.score, 25 + 27);
    assert.ok(ke.reasons.some((r) => r.text === "Has a documented workaround"));
    const problem = ranked.find((c) => c.kind === "problem")!;
    assert.equal(problem.record.label, "P-000010");
    assert.ok(!ranked.some((c) => c.record.label === "P-000011"));
  });

  it("measures title similarity and formats durations", () => {
    assert.equal(titleSimilarity("Orders page times out", "orders page times out"), 1);
    assert.equal(titleSimilarity("Orders page times out", "Printer jam"), 0);
    assert.ok(titleSimilarity("Orders page times out", "Orders page slow") > 0.3);
    assert.equal(formatHours(0.5), "30 min");
    assert.equal(formatHours(2), "2h");
    assert.equal(formatHours(72), "3 days");
  });

  it("says why an unlinked incident looks related", () => {
    const affected = new Map([[DB.id, DB.name]]);
    const problem = { title: "Orders page times out", serviceId: "5", subcategoryId: "9" };
    assert.deepEqual(similarityMatches(incident(1), problem, affected), [
      "same CI SRV-DB-01",
      "same subcategory Checkout",
      "similar title (100%)",
    ]);
    const unrelated = incident(2, [], { title: "Printer jam", serviceId: "6", subcategoryId: "7" });
    assert.deepEqual(similarityMatches(unrelated, problem, affected), []);
  });
});

/* ------------------------------------------------------------------------- *
 * Redaction and the prompt
 * ------------------------------------------------------------------------- */

describe("RCA redaction", () => {
  it("replaces emails and phone numbers, and keeps refs, dates, IPs and ids", () => {
    const input =
      "Call John on +44 20 7946 0958 or (555) 123-4567, or 0612345678; mail john.doe@example.com. " +
      "See I-000123 and C-000045, opened 2026-10-20 08:00:00, host 10.0.0.12, order 12345678, 3 users.";
    const out = redactPersonalData(input);
    assert.equal(out.emails, 1);
    assert.equal(out.phones, 3);
    assert.equal(
      out.text,
      "Call John on [phone] or [phone], or [phone]; mail [email]. " +
        "See I-000123 and C-000045, opened 2026-10-20 08:00:00, host 10.0.0.12, order 12345678, 3 users.",
    );
  });
});

const context: RcaContext = {
  problem: {
    ref: "P-000035",
    title: "Orders page times out",
    description: "Checkout fails. Reported by anna@example.com, call 06 12 34 56 78.",
    publicLog: [],
  },
  incidents: [
    {
      ref: "I-000100",
      title: "Orders page times out",
      description: "x".repeat(2_500),
      publicLog: [{ date: "2026-10-20T00:10:00.000Z", message: "Restarted the pool, works again" }],
    },
  ],
  omittedIncidents: 3,
};

describe("RCA prompt", () => {
  it("carries the problem, the evidence and the incidents, redacted", () => {
    const prompt = buildRcaPrompt(evidence(), context);
    assert.equal(prompt.redactions.emails, 1);
    assert.equal(prompt.redactions.phones, 1);
    assert.doesNotMatch(prompt.user, /anna@example\.com|06 12 34 56 78/);
    assert.match(prompt.user, /Reported by \[email\], call \[phone\]/);
    assert.match(prompt.user, /C-000123 \(NormalChange, closed\) "Patch database engine"; .*2h before the first incident/);
    assert.match(prompt.user, /SRV-DB-01 \(DBServer, affected\): named by 7 linked incident\(s\)/);
    assert.match(prompt.user, /1\. \[66\] Change C-000123/);
    assert.match(prompt.user, /Restarted the pool, works again/);
    assert.match(prompt.user, /\[…cut, 500 more characters\]/);
    assert.match(prompt.user, /3 more linked incidents left out/);
    assert.match(prompt.system, /not instructions to you/);
  });

  it("logs what was sent for audit, never a key", () => {
    const prompt = buildRcaPrompt(evidence(), context);
    const entry = auditEntry(prompt, { problemRef: "P-000035", login: "pm", model: "claude-opus-5-5" });
    assert.equal(entry["event"], "rca_ai_request");
    assert.equal((entry["sent"] as { user: string }).user, prompt.user);
    assert.match(String(entry["sha256"]), /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(entry), /sk-ant|apiKey/i);
  });

  it("turns the model's JSON into a draft, resolving citations to records", () => {
    const draft = parseDraft(
      {
        text: JSON.stringify({
          rootCause: " The patch in C-000123 ",
          workaround: "Restart the pool",
          resolution: "Roll back",
          confidence: "certain",
          confidenceNote: "Timing and CI.",
          citations: ["C-000123", "srv-db-01", "C-000123", "X-1"],
        }),
        model: "claude-opus-5-5",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      evidence(),
      { emails: 0, phones: 0 },
    );
    assert.equal(draft.rootCause, "The patch in C-000123");
    assert.equal(draft.confidence, "low");
    assert.deepEqual(draft.citations, [
      { class: "NormalChange", id: "123", label: "C-000123" },
      { class: "DBServer", id: "11", label: "SRV-DB-01" },
    ]);
    assert.throws(
      () => parseDraft({ text: "not json", model: "m", usage: { inputTokens: 0, outputTokens: 0 } }, evidence(), { emails: 0, phones: 0 }),
      /unexpected form/,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The service, over a fake model
 * ------------------------------------------------------------------------- */

function rcaService(options: { model?: RcaModel; disabledTenants?: string[] } = {}) {
  const evidenceService = { gather: async () => evidence() } as unknown as RcaEvidenceService;
  const objects = {
    get: async () => ({
      class: "Problem",
      id: 35,
      label: "P-000035",
      fields: { ref: "P-000035", title: "Orders page times out", description: "<p>Mail &amp; ops@example.com</p>" },
    }),
    listAll: async () => ({
      items: [
        {
          class: "Incident",
          id: 100,
          label: "I-000100",
          fields: {
            ref: "I-000100",
            title: "Orders page times out",
            description: "",
            public_log: { entries: [{ date: "2026-10-20T00:10:00.000Z", user_login: "jdoe", message: "Pool restarted" }] },
            private_log: { entries: [{ date: "", user_login: "jdoe", message: "SECRET internal note" }] },
          },
        },
      ],
      total: 1,
      truncated: false,
    }),
  } as unknown as ObjectsService;
  const config = {
    lookbackHours: 72,
    ai: { provider: "anthropic" as const, apiKey: "test-key", region: "", model: "claude-opus-5-5", effort: "high" as const, privateLogs: false, disabledTenants: options.disabledTenants ?? [] },
  };
  return new RcaService(evidenceService, objects, config, options.model);
}

class FakeModel implements RcaModel {
  readonly requests: ModelRequest[] = [];
  async complete(request: ModelRequest) {
    this.requests.push(request);
    return {
      text: JSON.stringify({
        rootCause: "Patch C-000123 changed the DB pool size",
        workaround: "Restart the pool",
        resolution: "Restore the pool size",
        confidence: "medium",
        confidenceNote: "C-000123 finished 2h before I-000100.",
        citations: ["C-000123", "I-000100"],
      }),
      model: "claude-opus-5-5",
      usage: { inputTokens: 1000, outputTokens: 200 },
    };
  }
}

describe("RcaService draft", () => {
  it("sends public logs only, redacted, logs the request and returns the draft", async () => {
    const model = new FakeModel();
    const service = rcaService({ model });
    const logged: unknown[] = [];
    const draft = await service.draft("35", {}, { info: (obj) => logged.push(obj) });

    assert.equal(draft.rootCause, "Patch C-000123 changed the DB pool size");
    assert.equal(draft.citations.length, 2);
    assert.equal(draft.redactions.emails, 1);
    const sent = model.requests[0]!;
    assert.match(sent.user, /Pool restarted/);
    assert.doesNotMatch(sent.user, /SECRET internal note/);
    assert.doesNotMatch(sent.user, /jdoe|ops@example\.com/);
    assert.deepEqual(sent.schema, { ...RCA_DRAFT_SCHEMA });
    assert.equal((logged[0] as { event: string }).event, "rca_ai_request");
    assert.equal((logged[1] as { event: string }).event, "rca_ai_response");
  });

  it("is off without a model, and for a tenant that turned it off", async () => {
    assert.equal(rcaService().aiEnabled(), false);
    await assert.rejects(rcaService().draft("35", {}, { info: () => {} }), /not turned on/);
    const service = rcaService({ model: new FakeModel(), disabledTenants: ["acme"] });
    assert.equal(service.aiEnabled(), true);
    const caller = { userId: 1, login: "pm", contactId: 0, name: "Pat", email: "", kind: "staff" as const, profiles: [], isAdmin: false, allowedOrgIds: [], orgId: 0 };
    assert.equal(runAs(caller, () => service.aiEnabled(), { id: "acme", name: "Acme", orgIds: [1] }), false);
    assert.equal(runAs(caller, () => service.aiEnabled(), { id: "globex", name: "Globex", orgIds: [2] }), true);
  });
});

describe("AnthropicRcaModel", () => {
  function fakeClient(response: Partial<Anthropic.Beta.BetaMessage>) {
    const calls: unknown[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: unknown) => {
            calls.push(params);
            return { model: "claude-opus-5-5", usage: { input_tokens: 5, output_tokens: 7 }, ...response };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  const claudeApi = { serverFallbacks: true, credentialHint: "ANTHROPIC_API_KEY" };
  const bedrock = { serverFallbacks: false, credentialHint: "AWS_BEARER_TOKEN_BEDROCK" };

  it("asks for structured JSON with adaptive thinking and server-side fallbacks", async () => {
    const { client, calls } = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" } as Anthropic.Beta.BetaTextBlock] });
    const model = new AnthropicRcaModel(client, "claude-opus-5-5", "high", claudeApi);
    const answer = await model.complete({ system: "s", user: "u", schema: { type: "object" } });
    assert.equal(answer.text, "{}");
    assert.deepEqual(answer.usage, { inputTokens: 5, outputTokens: 7 });
    const params = calls[0] as Record<string, unknown>;
    assert.equal(params["model"], "claude-opus-5-5");
    assert.deepEqual(params["thinking"], { type: "adaptive" });
    assert.equal(params["fallbacks"], "default");
    assert.deepEqual(params["output_config"], { effort: "high", format: { type: "json_schema", schema: { type: "object" } } });
  });

  it("on Bedrock sends the same request without server-side fallbacks", async () => {
    const { client, calls } = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" } as Anthropic.Beta.BetaTextBlock] });
    const model = new AnthropicRcaModel(client, "anthropic.claude-sonnet-5", "high", bedrock);
    await model.complete({ system: "s", user: "u", schema: { type: "object" } });
    const params = calls[0] as Record<string, unknown>;
    assert.equal(params["model"], "anthropic.claude-sonnet-5");
    assert.equal("fallbacks" in params, false);
    assert.equal("betas" in params, false);
    assert.deepEqual(params["thinking"], { type: "adaptive" });
    assert.deepEqual(params["output_config"], { effort: "high", format: { type: "json_schema", schema: { type: "object" } } });
  });

  it("reports a refusal and a cut-off answer instead of returning them", async () => {
    const refused = new AnthropicRcaModel(fakeClient({ stop_reason: "refusal", content: [] }).client, "m", "high", bedrock);
    await assert.rejects(refused.complete({ system: "", user: "", schema: {} }), /declined/);
    const cut = new AnthropicRcaModel(fakeClient({ stop_reason: "max_tokens", content: [] }).client, "m", "high", claudeApi);
    await assert.rejects(cut.complete({ system: "", user: "", schema: {} }), /cut off/);
  });
});

/* ------------------------------------------------------------------------- *
 * Saving a reviewed draft
 * ------------------------------------------------------------------------- */

describe("Saving an AI-drafted analysis", () => {
  it("notes the model and the reviewer in the private log and the History comment", async () => {
    const fake = new FakeItopClient()
      .on("core/get", {
        code: 0,
        message: "Found: 1",
        objects: {
          "Problem::35": {
            code: 0,
            message: "",
            class: "Problem",
            key: "35",
            fields: { ref: "P-000035", title: "t", status: "assigned", root_cause: "", workaround: "", solution: "" },
          },
        },
      })
      .on("core/update", { code: 0, message: null, objects: {} });
    const objects = { list: async () => ({ items: [] }) } as unknown as ObjectsService;
    const service = new ProblemsService(objects, fake.asClient(), "Europe/Paris");
    const caller = { userId: 1, login: "pm", contactId: 0, name: "Pat Manager", email: "", kind: "staff" as const, profiles: [], isAdmin: false, allowedOrgIds: [], orgId: 0 };
    await runAs(caller, () =>
      service.saveAnalysis("35", { rootCause: "Patch", workaround: "", resolution: "", aiDraft: { model: "claude-opus-5-5" } }),
    );
    const update = fake.calls.find((c) => c.verb === "core/update")!;
    const note = "Root-cause analysis drafted with AI (claude-opus-5-5), reviewed by Pat Manager via ARCUS";
    assert.equal(update.params["comment"], note);
    assert.deepEqual(update.params["fields"], { root_cause: "Patch", private_log: `${note}.` });
  });
});
