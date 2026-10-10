import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { Navigation } from "../src/platform/navigation/navigation.service.js";
import { AppError } from "../src/core/errors.js";
import { CmdbSchema } from "../src/schema/load.js";
import {
  FakeItopClient,
  getResponse,
  SAMPLE_RAW_SCHEMA,
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
  });
  after(async () => {
    await built.app.close();
  });
  return built.app;
}

describe("Navigation", () => {
  it("keeps iTop's OQL out of what it publishes", () => {
    // The whole reason views are addressed by id: a published query would put
    // iTop's datamodel back into the frontend.
    const navigation = sampleNavigation();
    const published = JSON.stringify({
      groups: navigation.groups,
      classLabels: navigation.classLabels,
      excluded: navigation.excluded,
    });

    assert.ok(!published.includes("SELECT"), "navigation must not publish OQL");
    assert.ok(!published.includes("oql"), "navigation must not publish an oql key");
  });

  it("marks which entries are filtered without saying how", () => {
    const navigation = sampleNavigation();
    const config = navigation.groups.find((g) => g.id === "ConfigManagement");
    const servers = config?.entries.find((e) => e.id === "Servers");
    const organizations = navigation.groups
      .find((g) => g.id === "DataAdministration")
      ?.entries.find((e) => e.id === "Organization");

    assert.equal(servers?.filtered, true);
    assert.equal(organizations?.filtered, false);
  });

  it("resolves a view id to the OQL iTop declared", () => {
    const view = sampleNavigation().resolveView("Servers");

    assert.equal(view.class, "Server");
    assert.equal(view.oql, "SELECT Server WHERE status = 'production'");
  });

  it("refuses an unknown view rather than listing everything", () => {
    // Falling back to "no filter" would quietly show every row of a class
    // where the caller asked for a subset.
    assert.throws(() => sampleNavigation().resolveView("NoSuchView"), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "not_found");
      return true;
    });
  });

  it("only registers views for entries that actually filter", () => {
    const navigation = sampleNavigation();

    // Organization is a plain list, so there is nothing to resolve.
    assert.deepEqual(navigation.viewIds, ["Servers"]);
  });

  it("drops an entry whose class is absent from the schema, with a reason", () => {
    // The schema and the navigation are two generated files. A stale one would
    // otherwise advertise a screen the BFF cannot serve.
    const navigation = sampleNavigation();
    const dataAdmin = navigation.groups.find((g) => g.id === "DataAdministration");

    assert.deepEqual(
      dataAdmin?.entries.map((e) => e.id),
      ["Organization"],
      "the entry pointing at NotInSchema should be gone",
    );
    const diagnostic = navigation.excluded.find((e) => e.id === "Ghosts");
    assert.ok(diagnostic, "dropping it must be reported");
    assert.match(diagnostic.reason, /unknown-class: NotInSchema/);
  });

  it("carries the extractor's own exclusions through", () => {
    const navigation = sampleNavigation();
    const dashboard = navigation.excluded.find((e) => e.id === "WelcomeMenuPage");

    assert.ok(dashboard, "exclusions decided during extraction must still be visible");
  });

  it("separates administering iTop from using it", () => {
    const navigation = sampleNavigation();

    assert.equal(navigation.groups.find((g) => g.id === "AdminTools")?.isAdmin, true);
    assert.equal(navigation.groups.find((g) => g.id === "ConfigManagement")?.isAdmin, false);
  });

  it("does not offer to create an abstract class", () => {
    const schema = CmdbSchema.fromRaw({
      ...SAMPLE_RAW_SCHEMA,
      AbstractThing: {
        is_ci: true,
        abstract: true,
        inherits: ["cmdbAbstractObject"],
        lifecycle: null,
        writable: ["name"],
        readonly: [],
        fields: { name: { type: "String", ui: "scalar", owner: "AbstractThing", required: true } },
      },
    });
    const navigation = Navigation.fromData(
      {
        groups: [
          {
            id: "ConfigManagement",
            label: "CMDB",
            rank: 20,
            isAdmin: false,
            entries: [
              // iTop really does this: "New CI" targets abstract FunctionalCI
              // and asks for the subclass in its own UI.
              { id: "NewCI", kind: "create", class: "AbstractThing", label: "New CI", rank: 10 },
            ],
          },
        ],
        classLabels: {},
        excluded: [],
      },
      schema,
    );

    assert.equal(navigation.groups[0]?.entries[0]?.creatable, false);
  });

  it("skips a group once every entry in it is unusable", () => {
    const navigation = Navigation.fromData(
      {
        groups: [
          {
            id: "Empty",
            label: "Empty",
            rank: 1,
            isAdmin: false,
            entries: [{ id: "X", kind: "list", class: "NotInSchema", label: "X", rank: 1 }],
          },
        ],
        classLabels: {},
        excluded: [],
      },
      sampleSchema(),
    );

    assert.deepEqual(navigation.groups, [], "a group with nothing to show must not appear");
  });
});

describe("GET /api/meta/navigation", () => {
  it("publishes groups, labels, exclusions and counts", async () => {
    const fake = new FakeItopClient();
    const response = await app(fake).inject({ method: "GET", url: "/api/meta/navigation" });
    const body = JSON.parse(response.body) as {
      groups: { id: string; entries: unknown[] }[];
      classLabels: Record<string, string>;
      excluded: unknown[];
      counts: { groups: number; entries: number; views: number; excluded: number };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.counts.groups, body.groups.length);
    assert.equal(body.counts.views, 1);
    assert.ok(body.counts.excluded >= 2);
    assert.equal(body.classLabels["Server"], "Server");
    assert.ok(!response.body.includes("SELECT"), "the response must not contain OQL");
  });
});

describe("listing through a view", () => {
  it("applies the view's OQL without the caller sending any", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 1, fields: { name: "web-01" } }]),
    );

    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Server?view=Servers",
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(fake.lastCall().params["key"]), /status = 'production'/);
  });

  it("rejects a view that belongs to another class", async () => {
    // Otherwise `/api/objects/Organization?view=Servers` would return servers
    // under an Organization heading.
    const fake = new FakeItopClient();
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Organization?view=Servers",
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /lists Server, not Organization/);
  });

  it("refuses view and oql together rather than picking one", async () => {
    const fake = new FakeItopClient();
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Server?view=Servers&oql=SELECT%20Server",
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /not both/);
  });

  it("404s an unknown view", async () => {
    const fake = new FakeItopClient();
    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Server?view=NoSuchView",
    });

    assert.equal(response.statusCode, 404);
  });

  it("does not treat `view` as a field filter", async () => {
    // Unreserved query params become exact-match filters, so `view` had to be
    // reserved or it would have been sent to iTop as an attribute named "view".
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await app(fake).inject({ method: "GET", url: "/api/objects/Server?view=Servers" });

    assert.ok(!String(fake.lastCall().params["key"]).includes("view ="));
  });
});
