import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import type { Caller } from "../src/core/request-context.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { PortalService } from "../src/platform/portal/portal.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, SAMPLE_RAW_SCHEMA } from "./helpers.js";

/**
 * The portal runs as the service account, so its scoping IS the access
 * control. These pin it to iTop's own portal scopes.
 */
const schema = CmdbSchema.fromRaw({
  ...SAMPLE_RAW_SCHEMA,
  UserRequest: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject", "Ticket"],
    lifecycle: {
      attribute: "status",
      states: { assigned: ["ev_resolve"], resolved: ["ev_close", "ev_reopen"], closed: [] },
      stimuli: ["ev_resolve", "ev_close", "ev_reopen"],
    },
    writable: [
      "title",
      "description",
      "org_id",
      "caller_id",
      "origin",
      "urgency",
      "impact",
      "priority",
      "service_id",
      "servicesubcategory_id",
      "status",
    ],
    readonly: [],
    fields: {
      title: { type: "String", ui: "scalar", owner: "Ticket", required: true },
      description: { type: "Text", ui: "scalar", owner: "Ticket", required: true },
      org_id: { type: "ExternalKey", ui: "picker", owner: "Ticket", target: "Organization", required: true },
      caller_id: { type: "ExternalKey", ui: "picker", owner: "Ticket", target: "Organization" },
      origin: { type: "Enum", ui: "scalar", owner: "UserRequest", values: ["portal", "mail"] },
      urgency: { type: "Enum", ui: "scalar", owner: "UserRequest", values: ["1", "2", "3", "4"] },
      impact: { type: "Enum", ui: "scalar", owner: "UserRequest", values: ["1", "2", "3"] },
      priority: { type: "Enum", ui: "scalar", owner: "UserRequest", values: ["1", "2", "3", "4"] },
      service_id: { type: "ExternalKey", ui: "picker", owner: "UserRequest", target: "Organization" },
      servicesubcategory_id: { type: "ExternalKey", ui: "picker", owner: "UserRequest", target: "Organization" },
      status: { type: "Enum", ui: "scalar", owner: "UserRequest", values: ["assigned", "resolved", "closed"] },
    },
  },
});

const jane: Caller = {
  userId: 30,
  login: "jane",
  contactId: 7,
  name: "Jane Doe",
  email: "",
  kind: "portal",
  profiles: ["Portal user"],
  isAdmin: false,
  allowedOrgIds: [],
  orgId: 3,
};

const service = (fake: FakeItopClient) =>
  new PortalService(fake.asClient(), schema, new ObjectsService(fake.asClient(), schema, "test"));

const ticket = (status: string) =>
  getResponse([
    {
      class: "UserRequest",
      id: 5,
      fields: { ref: "R-5", title: "Printer", status, operational_status: status === "closed" ? "closed" : "ongoing" },
    },
  ]);

describe("PortalService scope", () => {
  it("lists only the user's own tickets, as the service account", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).listTickets(jane, { closed: false, page: 1, limit: 20 });
    const key = String(fake.lastCall().params["key"]);
    assert.match(key, /finalclass IN \('UserRequest','Incident'\) AND caller_id = 7/);
    assert.match(key, /operational_status != 'closed'/);
    assert.equal(fake.lastCall().as, "service");
  });

  it("widens to the organisation for a portal power user", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).listTickets(
      { ...jane, profiles: ["Portal user", "Portal power user"] },
      { closed: true, page: 1, limit: 20 },
    );
    assert.match(String(fake.lastCall().params["key"]), /AND org_id = 3/);
  });

  it("answers 404 for a ticket outside the user's scope", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => service(fake).getTicket(jane, 99),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );
    assert.match(String(fake.lastCall().params["key"]), /id = 99 AND .*caller_id = 7/);
  });

  it("refuses an account with no linked person", async () => {
    await assert.rejects(
      () => service(new FakeItopClient()).listTickets({ ...jane, contactId: 0 }, { closed: false, page: 1, limit: 20 }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });
});

describe("PortalService actions", () => {
  it("offers close and reopen only where iTop's lifecycle allows", async () => {
    const resolved = new FakeItopClient().on("core/get", ticket("resolved"));
    assert.deepEqual((await service(resolved).getTicket(jane, 5)).actions, ["close", "reopen"]);
    const assigned = new FakeItopClient().on("core/get", ticket("assigned"));
    assert.deepEqual((await service(assigned).getTicket(jane, 5)).actions, []);
  });

  it("offers only what the user's own profiles grant", async () => {
    const resolved = new FakeItopClient().on("core/get", ticket("resolved"));
    assert.deepEqual((await service(resolved).getTicket({ ...jane, profiles: [] }, 5)).actions, []);
  });

  it("refuses an action the ticket cannot take now", async () => {
    const fake = new FakeItopClient().on("core/get", ticket("assigned"));
    await assert.rejects(
      () => service(fake).act(jane, 5, "close", {}),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("writes a comment authored as the user, not the service account", async () => {
    const fake = new FakeItopClient()
      .on("core/get", ticket("assigned"))
      .on("core/update", getResponse([{ class: "UserRequest", id: 5, fields: {} }]));
    await service(fake).comment(jane, 5, " Still broken ");
    const update = fake.calls.find((c) => c.verb === "core/update")!;
    assert.deepEqual(update.params["fields"], {
      public_log: { add_item: { message: "Still broken", user_id: 30, user_login: "Jane Doe" } },
    });
  });

  it("raises a request in the user's organisation, as its caller", async () => {
    const fake = new FakeItopClient()
      .on("core/create", getResponse([{ class: "UserRequest", id: 6, fields: {} }]))
      .on("core/get", ticket("assigned"));
    await service(fake).createRequest(jane, { title: "VPN", description: "Cannot connect" });
    const fields = fake.calls.find((c) => c.verb === "core/create")!.params["fields"] as Record<string, unknown>;
    assert.equal(fields["caller_id"], 7);
    assert.equal(fields["org_id"], 3);
    assert.equal(fields["origin"], "portal");
  });

  it("refuses a service the organisation is not contracted for", async () => {
    const fake = new FakeItopClient().on("core/get", [getResponse([]), getResponse([])]);
    await assert.rejects(
      () => service(fake).createRequest(jane, { title: "x", description: "y", serviceId: 42 }),
      (error: unknown) => error instanceof AppError && /not available to you/.test(error.message),
    );
  });
});

describe("ObjectsService.applyStimulus and internal stimuli", () => {
  it("refuses a stimulus iTop fires itself (ev_timeout), even for an admin", async () => {
    const withInternal = CmdbSchema.fromRaw({
      ...SAMPLE_RAW_SCHEMA,
      Ticketish: {
        is_ci: false,
        abstract: false,
        inherits: ["cmdbAbstractObject"],
        lifecycle: {
          attribute: "status",
          states: { new: ["ev_assign", "ev_timeout"] },
          stimuli: ["ev_assign", "ev_timeout"],
          user_stimuli: ["ev_assign"],
        },
        writable: ["status"],
        readonly: [],
        fields: { status: { type: "Enum", ui: "scalar", owner: "Ticketish", values: ["new"] } },
      },
    });
    const objects = new ObjectsService(new FakeItopClient().asClient(), withInternal, "test");
    await assert.rejects(
      () => objects.applyStimulus("Ticketish", 1, "ev_timeout", {}),
      (error: unknown) => error instanceof AppError && /not an action people can take/.test(error.message),
    );
  });
});

describe("PortalService at volume", () => {
  it("shows a busy caller's NEWEST requests, reading only the page asked for", async () => {
    // 1,500 tickets in iTop's order (oldest first): ids 1..1500.
    const fake = new FakeItopClient().on("core/get", (params) => {
      const limit = Number(params["limit"]);
      const page = Number(params["page"]);
      const from = (page - 1) * limit + 1;
      const rows = Array.from({ length: Math.max(0, Math.min(limit, 1500 - from + 1)) }, (_, i) => ({
        class: "UserRequest",
        id: from + i,
        fields: { ref: `R-${from + i}`, title: "t", status: "assigned", operational_status: "ongoing" },
      }));
      return getResponse(rows, 1500);
    });

    const result = await service(fake).listTickets(jane, { closed: false, page: 1, limit: 20 });

    assert.equal(result.total, 1500);
    assert.equal(result.pages, 75);
    assert.deepEqual(
      result.items.map((t) => t.id),
      Array.from({ length: 20 }, (_, i) => 1500 - i),
    );
    // A count, then iTop's last page: two calls whatever the volume.
    assert.equal(fake.calls.length, 2);
  });
});
