import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import type { ItopClient } from "../src/itop/client.js";
import { Dashboards } from "../src/platform/dashboards/dashboards.service.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import {
  FakeItopClient,
  getResponse,
  sampleDashboards,
  sampleNavigation,
  sampleSchema,
  testConfig,
} from "./helpers.js";

/**
 * Dashboards, computed from a dashlet's OQL on the BFF.
 *
 * The two things worth pinning: the OQL never appears in what is published,
 * and the grouping/counting the frontend relies on is done here, with iTop's
 * own enum labels.
 */

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

describe("Dashboards.public", () => {
  it("publishes structure without any OQL", () => {
    const dashboards = sampleDashboards(new FakeItopClient().asClient());
    const pub = dashboards.public("Server:Overview");

    assert.ok(!JSON.stringify(pub).includes("SELECT"), "no OQL may be published");
    assert.ok(!JSON.stringify(pub).includes("oql"));
    assert.equal(pub.dashlets.length, 4);
    assert.deepEqual(
      pub.dashlets.map((d) => d.kind),
      ["badge", "pie", "list", "text"],
    );
  });

  it("404s an unknown dashboard", () => {
    const dashboards = sampleDashboards(new FakeItopClient().asClient());
    assert.throws(() => dashboards.public("NoSuch"), /No dashboard/);
  });
});

describe("Dashboards.compute", () => {
  it("counts for a badge", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 1, fields: { id: "1" } }], 12),
    );

    const data = await sampleDashboards(fake.asClient()).compute("Server:Overview", "1");

    assert.equal(data.kind, "badge");
    if (data.kind === "badge") assert.equal(data.count, 12);
  });

  it("groups and counts, using iTop's enum labels", async () => {
    // Three servers: two production, one stock. status is an enum, so each
    // value is counted by iTop ("Found: N") rather than by reading rows.
    const fake = new FakeItopClient().on("core/get", countsByStatus({ production: 2, stock: 1 }));

    const data = await sampleDashboards(fake.asClient()).compute("Server:Overview", "2");

    assert.equal(data.kind, "pie");
    if (data.kind === "pie") {
      const prod = data.groups.find((g) => g.key === "production");
      assert.equal(prod?.count, 2);
      assert.equal(data.groups.find((g) => g.key === "stock")?.count, 1);
      assert.equal(data.total, 3);
      // sorted by count descending
      assert.equal(data.groups[0]?.key, "production");
    }
    // One count per enum value plus the total, each asking for one row.
    assert.ok(fake.calls.every((c) => c.params["limit"] === 1));
  });

  it("returns rows for a list, not the whole class", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 7, fields: { id: "7", name: "web-01" } }], 50),
    );

    const data = await sampleDashboards(fake.asClient()).compute("Server:Overview", "3");

    assert.equal(data.kind, "list");
    if (data.kind === "list") {
      assert.equal(data.total, 50);
      assert.equal(data.items[0]?.id, 7);
    }
  });

  it("needs no query for a static text dashlet", async () => {
    // A fake with no response configured would throw if the service queried.
    const data = await sampleDashboards(new FakeItopClient().asClient()).compute(
      "Server:Overview",
      "4",
    );

    assert.equal(data.kind, "text");
    if (data.kind === "text") assert.equal(data.text, "Static text");
  });
});

describe("dashboard routes", () => {
  it("lists dashboards", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/dashboards",
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { dashboards: { id: string }[] };
    assert.ok(body.dashboards.some((d) => d.id === "Server:Overview"));
  });

  it("serves a dashboard's structure with no OQL", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/dashboards/Server:Overview",
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("SELECT"));
  });

  it("computes a dashlet's data", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 1, fields: { id: "1" } }], 5),
    );
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/dashboards/Server:Overview/dashlets/1",
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"count":5/);
  });

  it("refuses a time zone that is not an IANA zone", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/dashboards/Server:Overview/dashlets/1?tz=Mars%2FOlympus",
    });
    assert.equal(response.statusCode, 400);
  });

  it("404s an unknown dashlet", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/dashboards/Server:Overview/dashlets/999",
    });
    assert.equal(response.statusCode, 404);
  });
});

/** Answers core/get with a "Found: N" for the status the OQL asks about. */
function countsByStatus(counts: Record<string, number>) {
  return (params: Record<string, unknown>) => {
    const key = String(params["key"]);
    const status = /status = '([a-z_]+)'/.exec(key)?.[1];
    const total = status ? (counts[status] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0);
    return getResponse([], total);
  };
}

describe("Dashboards.compute at volume", () => {
  it("counts an enum exactly however many rows match, without reading them", async () => {
    const fake = new FakeItopClient().on("core/get", countsByStatus({ production: 41_000, stock: 9_000 }));

    const data = await sampleDashboards(fake.asClient()).compute("Server:Overview", "2");

    assert.equal(data.kind, "pie");
    if (data.kind === "pie") {
      assert.equal(data.total, 50_000);
      assert.equal(data.groups.find((g) => g.key === "stock")?.count, 9_000);
      assert.equal(data.truncated, undefined);
    }
  });
});

/** A pie grouped by an open-ended attribute (an external key), which is scanned. */
function scanDashboards(client: ItopClient) {
  const schema = sampleSchema();
  return Dashboards.fromData(
    {
      dashboards: {
        "Server:Overview": {
          id: "Server:Overview",
          title: "Server overview",
          columns: 1,
          dashlets: [{ id: "2", kind: "pie", title: "By org", class: "Server", oql: "SELECT Server", groupBy: "org_id" }],
        },
      },
      skipped: [],
    },
    new ObjectsService(client, schema, "test"),
    schema,
  );
}

describe("Dashboards.compute labels", () => {
  it("names an external-key group by its friendly name, not its id", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse(
        [
          { class: "Server", id: 1, fields: { id: "1", org_id: "3", org_id_friendlyname: "Demo Org" } },
          { class: "Server", id: 2, fields: { id: "2", org_id: "3", org_id_friendlyname: "Demo Org" } },
        ],
        2,
      ),
    );

    const data = await scanDashboards(fake.asClient()).compute("Server:Overview", "2");

    assert.equal(data.kind, "pie");
    if (data.kind === "pie") {
      assert.deepEqual(data.groups, [{ key: "3", label: "Demo Org", count: 2 }]);
      assert.equal(data.keyType, "value");
    }
    assert.match(String(fake.calls[0]?.params["output_fields"]), /org_id_friendlyname/);
  });

  it("gives a day grouping full dates, in order, with quiet days filled in", async () => {
    const schema = sampleSchema();
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse(
        [
          { class: "Server", id: 1, fields: { id: "1", purchase_date: "2026-10-21" } },
          { class: "Server", id: 2, fields: { id: "2", purchase_date: "2026-10-19" } },
          { class: "Server", id: 3, fields: { id: "3", purchase_date: "2026-10-21" } },
        ],
        3,
      ),
    );
    const dashboards = Dashboards.fromData(
      {
        dashboards: {
          "Server:Overview": {
            id: "Server:Overview",
            title: "Server overview",
            columns: 1,
            dashlets: [
              {
                id: "5",
                kind: "bars",
                title: "Bought per day",
                class: "Server",
                oql: "SELECT Server",
                groupBy: "purchase_date",
                groupFn: "day_of_month",
              },
            ],
          },
        },
        skipped: [],
      },
      new ObjectsService(fake.asClient(), schema, "test"),
      schema,
    );

    const data = await dashboards.compute("Server:Overview", "5", { timeZone: "Asia/Kolkata" });

    assert.equal(data.kind, "bars");
    if (data.kind === "bars") {
      assert.equal(data.keyType, "day");
      assert.deepEqual(
        data.groups.map((g) => [g.key, g.count]),
        [
          ["2026-10-19", 1],
          ["2026-10-20", 0],
          ["2026-10-21", 2],
        ],
      );
    }
  });

  it("carries the class's own label", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 4));
    const data = await sampleDashboards(fake.asClient()).compute("Server:Overview", "1");
    assert.equal(data.kind, "badge");
    if (data.kind === "badge") assert.ok(data.label.length > 0);
  });
});

describe("Dashboards.compute over more than one page", () => {
  it("counts every matching row, not just the first 500", async () => {
    const page = (from: number, n: number, org: string) =>
      Array.from({ length: n }, (_, i) => ({
        class: "Server",
        id: from + i,
        fields: { id: String(from + i), org_id: org },
      }));
    const fake = new FakeItopClient().on("core/get", [
      getResponse(page(1, 500, "1"), 650),
      getResponse(page(501, 150, "2"), 650),
    ]);

    const data = await scanDashboards(fake.asClient()).compute("Server:Overview", "2");

    assert.equal(data.kind, "pie");
    if (data.kind === "pie") {
      assert.equal(data.total, 650);
      assert.equal(data.groups.find((g) => g.key === "2")?.count, 150);
      assert.equal(data.truncated, undefined);
    }
  });
});
