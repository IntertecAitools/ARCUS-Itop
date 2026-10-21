import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { AppError } from "../src/core/errors.js";
import {
  FakeItopClient,
  getResponse,
  sampleDashboards,
  sampleNavigation,
  sampleSchema,
  testConfig,
} from "./helpers.js";

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

describe("health routes", () => {
  it("reports liveness without touching iTop", async () => {
    const fake = new FakeItopClient();
    const response = await app(fake).inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.schemaClasses, 4);
    assert.equal(fake.calls.length, 0, "liveness must not depend on the backend");
  });

  it("reports upstream readiness", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/health/upstream",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "ok");
  });
});

describe("meta routes", () => {
  it("lists classes grouped for a navigation tree", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/classes",
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.groups.ci, ["Server"]);
    assert.ok(body.groups.lookup.includes("Organization"));
  });

  it("returns a full field descriptor for a class", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/classes/Server",
    });
    const body = response.json();
    assert.equal(body.fields.status.widget, "select");
    assert.deepEqual(body.fields.status.values, [
      "production",
      "implementation",
      "stock",
      "obsolete",
    ]);
    assert.ok(body.readonly.includes("brand_name"));
  });

  it("404s an unknown class", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/classes/Nope",
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "not_found");
  });

  it("400s a class name that is not an identifier", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/classes/Server;DROP",
    });
    assert.equal(response.statusCode, 400);
  });

  it("exposes the schema corrections it applied", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/meta/diagnostics",
    });
    const body = response.json();
    assert.ok(body.count > 0);
    assert.ok(
      body.diagnostics.some(
        (d: { class: string; field: string }) =>
          d.class === "Organization" && d.field === "parent_id",
      ),
    );
  });
});

describe("object routes", () => {
  it("lists objects with pagination metadata", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 1, fields: { friendlyname: "srv-01" } }], 60),
    );
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Server?page=1&limit=25",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.total, 60);
    assert.equal(body.pages, 3);
    assert.equal(body.items[0].label, "srv-01");
  });

  it("treats unreserved query params as filters", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await app(fake).inject({ method: "GET", url: "/api/objects/Server?status=production&page=2" });
    assert.equal(fake.lastCall().params["key"], "SELECT Server WHERE status = 'production'");
    assert.equal(fake.lastCall().params["page"], 2);
  });

  it("rejects a page of zero", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/objects/Server?page=0",
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "bad_request");
  });

  it("rejects a non-numeric id", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/objects/Server/abc",
    });
    assert.equal(response.statusCode, 400);
  });

  it("creates an object and returns 201", async () => {
    const fake = new FakeItopClient().on(
      "core/create",
      getResponse([{ class: "Server", id: 12, fields: { friendlyname: "srv-12" } }]),
    );
    const response = await app(fake).inject({
      method: "POST",
      url: "/api/objects/Server",
      payload: { fields: { name: "srv-12", org_id: 3 }, comment: "ticket 7" },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().object.id, 12);
    assert.equal(fake.lastCall().params["comment"], "ticket 7");
  });

  it("400s a create that is missing a required attribute", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "POST",
      url: "/api/objects/Server",
      payload: { fields: { name: "srv-12" } },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error.message, /org_id/);
  });

  it("400s a create that tries to set a computed field", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "POST",
      url: "/api/objects/Server",
      payload: { fields: { name: "x", org_id: 1, brand_name: "Dell" } },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error.message, /brand_id/);
  });

  it("reports dropped fields when strict is false", async () => {
    const fake = new FakeItopClient().on(
      "core/create",
      getResponse([{ class: "Server", id: 12, fields: {} }]),
    );
    const response = await app(fake).inject({
      method: "POST",
      url: "/api/objects/Server",
      payload: { fields: { name: "x", org_id: 1, brand_name: "Dell" }, strict: false },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().rejected.map((r: { field: string }) => r.field), [
      "brand_name",
    ]);
  });

  it("updates an object via PATCH", async () => {
    const fake = new FakeItopClient().on(
      "core/update",
      getResponse([{ class: "Server", id: 5, fields: { friendlyname: "srv-05" } }]),
    );
    const response = await app(fake).inject({
      method: "PATCH",
      url: "/api/objects/Server/5",
      payload: { fields: { status: "stock" } },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(fake.lastCall().params["key"], 5);
    assert.deepEqual(fake.lastCall().params["fields"], { status: "stock" });
  });

  it("simulates a delete without modifying anything", async () => {
    const fake = new FakeItopClient().on("core/delete", {
      code: 0,
      message: "SIMULATING: Deleted: 1",
      objects: {
        "Server::5": { code: 0, message: "", class: "Server", key: "5", fields: {} },
      },
    });
    const response = await app(fake).inject({
      method: "DELETE",
      url: "/api/objects/Server/5?simulate=true",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().simulated, true);
    assert.equal(fake.lastCall().params["simulate"], true);
  });

  it("409s a delete that would cascade", async () => {
    const fake = new FakeItopClient().on("core/delete", {
      code: 12,
      message: "The deletion requires that other objects be deleted/updated",
      objects: null,
    });
    const response = await app(fake).inject({ method: "DELETE", url: "/api/objects/Server/5" });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "unsafe_operation");
  });

  it("serves related objects through a link set", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 0));
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Server/5/links/softwares_list",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(fake.lastCall().params["key"], "SELECT SoftwareInstance WHERE system_id = 5");
  });

  it("400s an unknown relation name", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/objects/Server/5/related?relation=invents",
    });
    assert.equal(response.statusCode, 400);
  });

  it("returns an impact graph", async () => {
    const fake = new FakeItopClient().on("core/get_related", {
      code: 0,
      message: "Scope: 1; Related objects: Server= 2",
      objects: {
        "Server::5": { code: 0, message: "", class: "Server", key: "5", fields: { friendlyname: "a" } },
        "Server::6": { code: 0, message: "", class: "Server", key: "6", fields: { friendlyname: "b" } },
      },
      relations: { "Server::5": [{ key: "Server::6" }] },
    });

    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Server/5/related?relation=impacts&direction=down",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.nodes.length, 2);
    assert.deepEqual(body.edges, [{ from: "Server::5", to: "Server::6" }]);
  });
});

describe("lookup routes", () => {
  it("serves picker options with form context", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Model", id: 2, fields: { friendlyname: "PowerEdge" } }]),
    );
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/meta/classes/Server/fields/model_id/options?brand_id=7",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(fake.lastCall().params["key"], "SELECT Model WHERE brand_id = 7");
    assert.deepEqual(response.json().options, [{ id: 2, label: "PowerEdge" }]);
  });
});

describe("error handling", () => {
  it("404s an unknown route with the standard error envelope", async () => {
    const response = await app(new FakeItopClient()).inject({ method: "GET", url: "/nope" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "not_found");
  });

  it("400s a malformed JSON body", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "POST",
      url: "/api/objects/Server",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.equal(response.statusCode, 400);
  });

  it("answers a CORS preflight", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "OPTIONS",
      url: "/api/objects/Server",
      headers: { origin: "http://localhost:3000" },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "*");
    assert.match(String(response.headers["access-control-allow-methods"]), /PATCH/);
  });
});

describe("security headers", () => {
  it("are on every response, errors included, and nothing is cached", async () => {
    const fake = new FakeItopClient();
    for (const url of ["/health", "/api/no-such-route"]) {
      const res = await app(fake).inject({ method: "GET", url });
      assert.equal(res.headers["x-content-type-options"], "nosniff", url);
      assert.equal(res.headers["x-frame-options"], "DENY", url);
      assert.equal(res.headers["referrer-policy"], "no-referrer", url);
      assert.match(String(res.headers["content-security-policy"]), /default-src 'none'.*frame-ancestors 'none'/, url);
      assert.equal(res.headers["cache-control"], "no-store", url);
    }
  });
});

describe("5xx answers", () => {
  it("keep iTop's internal address and raw upstream text to the log", async () => {
    const fake = new FakeItopClient();
    fake.callRaw = async () => {
      throw new AppError("upstream_error", "iTop returned HTTP 500 for core/get. Check that http://itop-internal:8080/webservices/rest.php is correct.", {
        details: "Fatal error: /var/www/itop/core/dbobject.class.inc.php line 12",
      });
    };
    const res = await app(fake).inject({ method: "GET", url: "/api/objects/Server" });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, "upstream_error");
    assert.ok(!/itop-internal|dbobject|Fatal/.test(res.body), res.body);
    assert.equal(res.json().error.details, undefined);
  });

  it("still show the message iTop itself answered with", async () => {
    const fake = new FakeItopClient().on("core/get", { code: 100, message: "Error: the value 'x' is not allowed" });
    const res = await app(fake).inject({ method: "GET", url: "/api/objects/Server" });
    assert.equal(res.statusCode, 502);
    assert.match(res.json().error.message, /is not allowed/);
    assert.equal(res.json().error.itopCode, 100);
  });
});

describe("Object.prototype names as field codes", () => {
  it("are unknown attributes and dashboards, not 500s", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const criteria = encodeURIComponent(JSON.stringify([{ field: "constructor", op: "=", value: "x" }]));
    for (const [url, status] of [
      ["/api/objects/Server?constructor=x", 400],
      ["/api/objects/Server?sort=toString", 400],
      [`/api/objects/Server?criteria=${criteria}`, 400],
      ["/api/meta/dashboards/constructor", 404],
    ] as const) {
      const res = await app(fake).inject({ method: "GET", url });
      assert.equal(res.statusCode, status, `${url}: ${res.body}`);
    }
  });
});
