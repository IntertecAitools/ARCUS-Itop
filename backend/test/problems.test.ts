import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { AppError } from "../src/core/errors.js";
import { ProblemsService } from "../src/modules/problems/index.js";
import { htmlToText } from "../src/modules/problems/text.js";
import { bucketStart, bucketStarts, buildTrends, type TrendRow } from "../src/modules/problems/trends.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import { FakeItopClient, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

const TZ = "Europe/Paris";

/* ------------------------------------------------------------------------- *
 * The service, over a fake iTop and a stubbed objects layer
 * ------------------------------------------------------------------------- */

/** A Problem as core/get returns it. With `extension: false`, iTop's answer without arcus-problem-rca. */
function problem(fields: Record<string, unknown> = {}, extension = true): Record<string, unknown> {
  return {
    ref: "P-000035",
    title: "Mail queue stalls",
    status: "assigned",
    description: "<p>Mail stops &amp; queues</p>",
    org_id: "3",
    functionalcis_list: [],
    ...(extension ? { root_cause: "", workaround: "", solution: "" } : {}),
    ...fields,
  };
}

const found = (fields: Record<string, unknown>) => ({
  code: 0,
  message: "Found: 1",
  objects: { "Problem::35": { code: 0, message: "", class: "Problem", key: "35", fields } },
});

function stub(fields = problem(), { updateError }: { updateError?: string } = {}) {
  const fake = new FakeItopClient()
    .on("core/get", found(fields))
    .on("core/update", updateError ? { code: 100, message: updateError } : { code: 0, message: null, objects: {} });
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const objects = {
    list: async (...args: unknown[]) => {
      calls.push({ op: "list", args });
      return { items: [{ class: "KnownError", id: 4, label: "KE", fields: { name: "Old KE" } }] };
    },
    create: async (...args: unknown[]) => {
      calls.push({ op: "create", args });
      return { object: { class: "KnownError", id: 9, label: "KE", fields: { name: (args[1] as { name: string }).name } }, rejected: [] };
    },
    addLink: async (...args: unknown[]) => {
      calls.push({ op: "addLink", args });
      if (args[3] === 666) throw new Error("not allowed");
      return { object: {} };
    },
  } as unknown as ObjectsService;
  return { service: new ProblemsService(objects, fake.asClient(), TZ), calls, fake };
}

const analysed = (rootCause: string, workaround = "", solution = "") =>
  problem({ root_cause: rootCause, workaround, solution });

describe("ProblemsService analysis", () => {
  it("reads the extension's fields and the problem's known errors", async () => {
    const { service, calls, fake } = stub(analysed("Cert expired", "Renew by hand", "Automate"));
    const result = await service.getAnalysis("35");
    assert.equal(result.available, true);
    assert.equal(result.rootCause, "Cert expired");
    assert.equal(result.workaround, "Renew by hand");
    assert.equal(result.resolution, "Automate");
    assert.deepEqual(result.knownErrors, [{ id: "4", name: "Old KE" }]);
    const get = fake.calls.find((c) => c.verb === "core/get")!;
    assert.match(String(get.params["output_fields"]), /root_cause,workaround,solution/);
    const list = calls.find((c) => c.op === "list")!;
    assert.match((list.args[1] as { oql: string }).oql, /problem_id = 35$/);
  });

  it("reports an iTop without the extension as unavailable, and refuses to save there", async () => {
    const { service, fake } = stub(problem({}, false));
    const result = await service.getAnalysis("35");
    assert.equal(result.available, false);
    assert.equal(result.rootCause, "");
    await assert.rejects(
      service.saveAnalysis("35", { rootCause: "x", workaround: "", resolution: "" }),
      (e: unknown) => e instanceof AppError && e.code === "conflict" && /arcus-problem-rca/.test(e.message),
    );
    assert.equal(fake.calls.filter((c) => c.verb === "core/update").length, 0);
  });

  it("a missing problem is a 404", async () => {
    const fake = new FakeItopClient().on("core/get", { code: 0, message: "Found: 0", objects: null });
    const objects = { list: async () => ({ items: [] }) } as unknown as ObjectsService;
    await assert.rejects(new ProblemsService(objects, fake.asClient(), TZ).getAnalysis("35"), /not found/);
  });

  it("writes only the changed fields, trimmed", async () => {
    const { service, fake } = stub(analysed("DNS TTL"));
    const result = await service.saveAnalysis("35", {
      rootCause: "DNS TTL",
      workaround: " Flush caches ",
      resolution: "Lower TTL",
    });
    const update = fake.calls.find((c) => c.verb === "core/update")!;
    assert.equal(update.params["class"], "Problem");
    assert.equal(update.params["key"], 35);
    assert.deepEqual(update.params["fields"], { workaround: "Flush caches", solution: "Lower TTL" });
    assert.ok(update.params["comment"]);
    assert.equal(result.workaround, "Flush caches");
    assert.equal(result.resolution, "Lower TTL");
  });

  it("writes nothing when nothing changed", async () => {
    const { service, fake } = stub(analysed("Cert expired"));
    await service.saveAnalysis("35", { rootCause: "Cert expired  ", workaround: "", resolution: "" });
    assert.equal(fake.calls.filter((c) => c.verb === "core/update").length, 0);
  });

  it("turns iTop's 'Unknown attribute' into the extension message", async () => {
    // The fields were read, but the write reached an iTop without them.
    const { service } = stub(analysed(""), { updateError: "Error: Unknown attribute root_cause from class Problem" });
    await assert.rejects(
      service.saveAnalysis("35", { rootCause: "x", workaround: "", resolution: "" }),
      /arcus-problem-rca/,
    );
  });
});

describe("ProblemsService known errors", () => {
  it("refuses a problem with no root cause or workaround yet", async () => {
    const { service, calls } = stub();
    await assert.rejects(service.createKnownError("35", {}), /root cause or a workaround/);
    assert.equal(calls.filter((c) => c.op === "create").length, 0);
  });

  it("refuses on an iTop without the extension", async () => {
    const { service } = stub(problem({}, false));
    await assert.rejects(service.createKnownError("35", {}), /arcus-problem-rca/);
  });

  it("copies the analysis, links back to the problem and copies its CIs", async () => {
    const fields = analysed("Cert expired", "Renew by hand", "Automated renewal");
    fields["functionalcis_list"] = [
      { functionalci_id: "12", functionalci_name: "mail-01" },
      { functionalci_id: "12", functionalci_name: "mail-01" },
      { functionalci_id: "666", functionalci_name: "other tenant" },
    ];
    const { service, calls } = stub(fields);
    const created = await service.createKnownError("35", { domain: "Server" });

    const create = calls.find((c) => c.op === "create")!;
    assert.equal(create.args[0], "KnownError");
    assert.deepEqual(create.args[1], {
      name: "P-000035: Mail queue stalls",
      org_id: 3,
      problem_id: 35,
      symptom: "Mail stops & queues",
      domain: "Server",
      root_cause: "Cert expired",
      workaround: "Renew by hand",
      solution: "Automated renewal",
    });
    // Duplicates collapse; a CI that cannot be linked does not lose the known error.
    const links = calls.filter((c) => c.op === "addLink");
    assert.deepEqual(links.map((c) => c.args[3]), [12, 666]);
    assert.deepEqual(links[0]!.args.slice(0, 3), ["KnownError", 9, "ci_list"]);
    assert.deepEqual(created, { id: "9", name: "P-000035: Mail queue stalls", problemId: "35", linkedCis: 1 });
  });

  it("uses the name and symptom the agent gave", async () => {
    const { service, calls } = stub(analysed("x"));
    await service.createKnownError("35", { name: "  Mail cert  ", symptom: "Mail bounces", errorCode: "E42" });
    const fields = calls.find((c) => c.op === "create")!.args[1] as Record<string, unknown>;
    assert.equal(fields["name"], "Mail cert");
    assert.equal(fields["symptom"], "Mail bounces");
    assert.equal(fields["error_code"], "E42");
    assert.equal(fields["domain"], "Application");
  });

  it("turns an HTML description into the plain-text symptom", () => {
    assert.equal(htmlToText("<p>one &lt;two&gt;<br />three</p><p>four&#39;s</p>"), "one <two>\nthree\n\nfour's");
  });
});

/* ------------------------------------------------------------------------- *
 * Trend arithmetic
 * ------------------------------------------------------------------------- */

const ticket = (id: string, startDate: string, extra: Partial<TrendRow> = {}): TrendRow => ({
  id,
  ref: `I-${id}`,
  startDate,
  serviceId: "1",
  serviceName: "Email",
  categoryId: "0",
  categoryName: "",
  cis: [],
  ...extra,
});

describe("trend buckets", () => {
  it("weeks start on Monday, months on the 1st", () => {
    assert.equal(bucketStart("2026-10-23", "week"), "2026-10-19"); // a Friday
    assert.equal(bucketStart("2026-10-19", "week"), "2026-10-19");
    assert.equal(bucketStart("2026-10-25", "week"), "2026-10-19"); // a Sunday
    assert.equal(bucketStart("2026-10-23", "month"), "2026-10-01");
  });

  it("covers the window end to end, across a year boundary", () => {
    assert.deepEqual(bucketStarts("2025-11-15", "2026-02-03", "month"), [
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    assert.equal(bucketStarts("2026-09-24", "2026-10-23", "week").length, 5);
  });
});

describe("buildTrends", () => {
  const base = { period: "30d" as const, today: "2026-10-23", timeZone: TZ, truncated: false };

  it("flags a service whose incidents keep coming back without a problem", () => {
    const result = buildTrends({
      ...base,
      groupBy: "service",
      incidents: [
        ticket("1", "2026-10-01T09:00:00.000Z"),
        ticket("2", "2026-10-08T09:00:00.000Z"),
        ticket("3", "2026-10-20T09:00:00.000Z"),
        ticket("4", "2026-10-21T09:00:00.000Z", { serviceId: "2", serviceName: "VPN", problemId: "35", problemRef: "P-35" }),
        // Outside the window: ignored.
        ticket("5", "2026-08-01T09:00:00.000Z"),
      ],
      problems: [ticket("35", "2026-10-21T10:00:00.000Z", { ref: "P-35", serviceId: "2", serviceName: "VPN", status: "assigned" })],
    });

    assert.equal(result.bucket, "week");
    assert.equal(result.from, "2026-09-24");
    assert.deepEqual(result.totals, { incidents: 4, linkedIncidents: 1, problems: 1, recurringGroups: 1 });

    const [email, vpn] = result.groups;
    assert.equal(email!.name, "Email");
    assert.equal(email!.incidents, 3);
    assert.equal(email!.unlinkedIncidents, 3);
    assert.equal(email!.activeBuckets, 3);
    assert.equal(email!.recurring, true);
    assert.equal(email!.lastIncidentAt, "2026-10-20T09:00:00.000Z");
    assert.equal(email!.perBucket.reduce((a, b) => a + b, 0), 3);

    assert.equal(vpn!.recurring, false);
    assert.equal(vpn!.linkedIncidents, 1);
    assert.equal(vpn!.openProblems, 1);
    assert.deepEqual(vpn!.problemRefs, [{ id: "35", ref: "P-35" }]);

    const last = result.buckets.at(-1)!;
    assert.deepEqual(last, { start: "2026-10-19", incidents: 2, linkedIncidents: 1, problems: 1 });
  });

  it("counts a ticket for each of its CIs, and once for none", () => {
    const result = buildTrends({
      ...base,
      groupBy: "ci",
      incidents: [
        ticket("1", "2026-10-20T09:00:00.000Z", {
          cis: [
            { id: "7", name: "mail-01" },
            { id: "8", name: "mail-02" },
          ],
        }),
        ticket("2", "2026-10-21T09:00:00.000Z"),
      ],
      problems: [],
    });
    assert.deepEqual(
      result.groups.map((g) => [g.name, g.incidents]),
      [
        ["mail-01", 1],
        ["mail-02", 1],
        ["No configuration item", 1],
      ],
    );
    assert.equal(result.totals.incidents, 2);
  });

  it("groups by category with a 'No category' bucket, by month for long periods", () => {
    const result = buildTrends({
      ...base,
      period: "365d",
      groupBy: "category",
      incidents: [ticket("1", "2026-03-01T09:00:00.000Z", { categoryId: "5", categoryName: "Mailbox full" }), ticket("2", "2026-04-01T09:00:00.000Z")],
      problems: [],
    });
    assert.equal(result.bucket, "month");
    assert.equal(result.buckets.length, 13);
    assert.deepEqual(result.groups.map((g) => g.name).sort(), ["Mailbox full", "No category"]);
  });
});

/* ------------------------------------------------------------------------- *
 * Routes: validation happens before iTop is asked
 * ------------------------------------------------------------------------- */

function app(fake: FakeItopClient) {
  const schema = sampleSchema();
  const built = buildApp(testConfig(), {
    client: fake.asClient(),
    schema,
    navigation: sampleNavigation(schema),
    dashboards: sampleDashboards(fake.asClient(), schema),
  });
  after(async () => {
    await built.app.close();
  });
  return built.app;
}

describe("problem routes", () => {
  it("rejects bad input with 400 and no iTop call", async () => {
    const fake = new FakeItopClient();
    const server = app(fake);
    const cases = [
      { method: "GET" as const, url: "/api/problems/abc/analysis" },
      { method: "GET" as const, url: "/api/problems/trends?period=7d" },
      { method: "GET" as const, url: "/api/problems/trends?groupBy=team" },
      { method: "PUT" as const, url: "/api/problems/1/analysis", payload: { rootCause: 42 } },
      { method: "POST" as const, url: "/api/problems/1/known-errors", payload: { domain: "Mainframe" } },
    ];
    for (const c of cases) {
      const response = await server.inject(c);
      assert.equal(response.statusCode, 400, `${c.method} ${c.url}`);
    }
    assert.equal(fake.calls.length, 0);
  });
});
