import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { AppError } from "../src/core/errors.js";
import type { Caller } from "../src/core/request-context.js";
import {
  checkAnswers,
  cleanFields,
  mergeFields,
  RequestFormsService,
  withAnswers,
} from "../src/modules/request-forms/request-forms.service.js";
import { MemoryRequestFormStore } from "../src/modules/request-forms/request-forms.store.js";
import type { FormField, RequestForm } from "../src/modules/request-forms/request-forms.types.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { PortalService } from "../src/platform/portal/portal.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, SAMPLE_RAW_SCHEMA, testConfig } from "./helpers.js";

const laptop: FormField[] = [
  { key: "model", label: "Laptop model", type: "choice", required: true, options: ["X1", "T14"] },
  { key: "needed_by", label: "Needed by", type: "date", required: false },
  { key: "budget", label: "Budget", type: "number", required: false },
  { key: "reason", label: "Reason", type: "textarea", required: false },
];

const form = (scope: "service" | "subcategory", targetId: number, fields: FormField[]): RequestForm => ({
  scope,
  targetId,
  fields,
  updatedAt: "",
  updatedBy: "",
});

const badRequest = (pattern: RegExp) => (error: unknown) =>
  error instanceof AppError && error.status === 400 && pattern.test(error.message);

describe("request form answers", () => {
  it("checks every answer and reports all problems at once", () => {
    assert.throws(
      () => checkAnswers(laptop, { needed_by: "2026-02-30", budget: "lots" }),
      badRequest(/Laptop model is required\. Needed by must be a date.*Budget must be a number/),
    );
    assert.throws(() => checkAnswers(laptop, { model: "Mac" }), badRequest(/must be one of: X1, T14/));
  });

  it("keeps the form's order, drops empty optional answers and unknown keys", () => {
    assert.deepEqual(checkAnswers(laptop, { reason: "new hire", model: " X1 ", budget: "", other: "x" }), [
      { label: "Laptop model", value: "X1" },
      { label: "Reason", value: "new hire" },
    ]);
  });

  it("appends the answers as HTML, as iTop stores a ticket's description, escaping what was typed", () => {
    assert.equal(
      withAnswers("Need a laptop\nfor <Ana>\n", [
        { label: "Laptop model", value: "X1 & dock" },
        { label: "Reason", value: "line one\nline two" },
      ]),
      "<p>Need a laptop<br>for &lt;Ana&gt;</p><p><strong>Request details</strong></p>" +
        "<ul><li><strong>Laptop model:</strong> X1 &amp; dock</li><li><strong>Reason:</strong> line one<br>line two</li></ul>",
    );
    // A description that is already HTML is kept as it is.
    assert.equal(
      withAnswers("<p>Hi</p>", [{ label: "A", value: "b" }]),
      "<p>Hi</p><p><strong>Request details</strong></p><ul><li><strong>A:</strong> b</li></ul>",
    );
    assert.equal(withAnswers("Unchanged", []), "Unchanged");
  });

  it("asks the service's fields, then the subcategory's, which win on a shared key", () => {
    const sub: FormField[] = [
      { key: "budget", label: "Budget (EUR)", type: "number", required: true },
      { key: "dock", label: "Dock", type: "text", required: false },
    ];
    assert.deepEqual(
      mergeFields(laptop, sub).map((f) => f.label),
      ["Laptop model", "Needed by", "Budget (EUR)", "Reason", "Dock"],
    );
  });
});

describe("request form definitions", () => {
  it("cleans a definition and refuses duplicates and empty choices", () => {
    assert.deepEqual(
      cleanFields([{ key: "a", label: " A ", type: "choice", required: false, options: ["x", " x", ""], help: " " }]),
      [{ key: "a", label: "A", type: "choice", required: false, options: ["x"] }],
    );
    assert.deepEqual(cleanFields([{ key: "b", label: "B", type: "text", required: true, options: ["stray"] }]), [
      { key: "b", label: "B", type: "text", required: true },
    ]);
    assert.throws(
      () => cleanFields([laptop[1]!, { ...laptop[1]!, label: "Again" }]),
      badRequest(/share the key "needed_by"/),
    );
    assert.throws(() => cleanFields([{ ...laptop[0]!, options: [] }]), badRequest(/at least one option/));
  });

  it("saves only for a catalogue item the administrator can see, and removes an emptied form", async () => {
    const store = new MemoryRequestFormStore();
    const missing = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => new RequestFormsService(missing.asClient(), store).save("service", 9, laptop),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );

    const fake = new FakeItopClient().on("core/get", getResponse([{ class: "Service", id: 9, fields: { name: "Laptops" } }]));
    const forms = new RequestFormsService(fake.asClient(), store);
    const saved = await forms.save("service", 9, laptop);
    assert.equal(saved.targetName, "Laptops");
    assert.equal(saved.fields.length, 4);
    assert.match(String(fake.calls[0]!.params["key"]), /SELECT Service WHERE id = 9/);

    await forms.save("service", 9, []);
    assert.equal(await store.get("service", 9), undefined);
  });

  it("lists the catalogue with how many fields each item asks", async () => {
    const store = new MemoryRequestFormStore([form("service", 1, laptop), form("subcategory", 11, laptop.slice(0, 1))]);
    const fake = new FakeItopClient().on("core/get", (params) =>
      params["class"] === "Service"
        ? getResponse([{ class: "Service", id: 1, fields: { name: "Laptops", servicefamily_name: "IT" } }])
        : getResponse([
            { class: "ServiceSubcategory", id: 11, fields: { name: "New laptop", service_id: 1 } },
            { class: "ServiceSubcategory", id: 12, fields: { name: "Repair", service_id: 1 } },
          ]),
    );
    const { services } = await new RequestFormsService(fake.asClient(), store).catalogue();
    assert.deepEqual(services, [
      {
        id: 1,
        name: "Laptops",
        family: "IT",
        fieldCount: 4,
        subcategories: [
          { id: 11, name: "New laptop", fieldCount: 1 },
          { id: 12, name: "Repair", fieldCount: 0 },
        ],
      },
    ]);
  });
});

/** The routes, with a datamodel that has requests and their SLA target. */
const schema = CmdbSchema.fromRaw({
  ...SAMPLE_RAW_SCHEMA,
  UserRequest: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject", "Ticket"],
    lifecycle: null,
    writable: ["title", "description", "org_id", "service_id", "servicesubcategory_id"],
    readonly: ["ttr_escalation_deadline", "sla_ttr_passed"],
    fields: {
      title: { type: "String", ui: "scalar", owner: "Ticket", required: true },
      description: { type: "Text", ui: "scalar", owner: "Ticket", required: true },
      org_id: { type: "ExternalKey", ui: "picker", owner: "Ticket", target: "Organization", required: true },
      service_id: { type: "ExternalKey", ui: "picker", owner: "UserRequest", target: "Organization" },
      servicesubcategory_id: { type: "ExternalKey", ui: "picker", owner: "UserRequest", target: "Organization" },
      ttr_escalation_deadline: { type: "SubItem", ui: "scalar", owner: "UserRequest" },
      sla_ttr_passed: { type: "SubItem", ui: "scalar", owner: "UserRequest" },
    },
  },
});

function app(fake: FakeItopClient, store = new MemoryRequestFormStore([form("service", 5, laptop)])) {
  const built = buildApp(testConfig(), {
    client: fake.asClient(),
    schema,
    navigation: sampleNavigation(schema),
    dashboards: sampleDashboards(fake.asClient(), schema),
    requestForms: store,
  });
  after(async () => {
    await built.app.close();
  });
  return built.app;
}

describe("request forms on a staff create", () => {
  const created = getResponse([{ class: "UserRequest", id: 70, fields: { title: "Laptop" } }]);

  it("writes the answers into the new request's description", async () => {
    const fake = new FakeItopClient().on("core/create", created);
    const response = await app(fake).inject({
      method: "POST",
      url: "/api/objects/UserRequest",
      payload: {
        fields: { title: "Laptop", description: "For the new hire", org_id: 1, service_id: "5" },
        formAnswers: { model: "T14", needed_by: "2026-11-02" },
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    const fields = fake.calls.find((c) => c.verb === "core/create")!.params["fields"] as Record<string, unknown>;
    assert.equal(
      fields["description"],
      "<p>For the new hire</p><p><strong>Request details</strong></p>" +
        "<ul><li><strong>Laptop model:</strong> T14</li><li><strong>Needed by:</strong> 2026-11-02</li></ul>",
    );
  });

  it("refuses a request whose required questions are unanswered, before iTop is called", async () => {
    const fake = new FakeItopClient().on("core/create", created);
    const response = await app(fake).inject({
      method: "POST",
      url: "/api/objects/UserRequest",
      payload: { fields: { title: "Laptop", description: "x", org_id: 1, service_id: 5 } },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error.message, /Laptop model is required/);
    assert.equal(fake.calls.filter((c) => c.verb === "core/create").length, 0);
  });

  it("leaves a request for a service with no form untouched", async () => {
    const fake = new FakeItopClient().on("core/create", created);
    await app(fake).inject({
      method: "POST",
      url: "/api/objects/UserRequest",
      payload: { fields: { title: "Other", description: "As typed", org_id: 1, service_id: 6 } },
    });
    const fields = fake.calls.find((c) => c.verb === "core/create")!.params["fields"] as Record<string, unknown>;
    assert.equal(fields["description"], "As typed");
  });

  it("resolves a catalogue item's form for staff", async () => {
    const response = await app(new FakeItopClient()).inject({
      method: "GET",
      url: "/api/request-forms/resolve?serviceId=5&subcategoryId=50",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().fields.length, 4);
  });
});

describe("the requester's target date", () => {
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

  it("reads iTop's time-to-resolve deadline and reports it as an instant", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([
        {
          class: "UserRequest",
          id: 5,
          fields: { ref: "R-5", status: "assigned", ttr_escalation_deadline: "2026-11-02 17:00:00", sla_ttr_passed: "yes" },
        },
      ]),
    );
    const portal = new PortalService(fake.asClient(), schema, new ObjectsService(fake.asClient(), schema, "test"));
    const ticket = await portal.getTicket(jane, 5);
    assert.equal(ticket.targetDate, "2026-11-02T16:00:00.000Z"); // Europe/Paris, winter time
    assert.equal(ticket.targetMissed, true);
    assert.match(String(fake.lastCall().params["output_fields"]), /UserRequest:.*ttr_escalation_deadline,sla_ttr_passed/);
  });

  it("asks only for target fields the datamodel has", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const portal = new PortalService(fake.asClient(), schema, new ObjectsService(fake.asClient(), schema, "test"));
    await portal.listTickets(jane, { closed: false, page: 1, limit: 20 });
    const spec = String(fake.lastCall().params["output_fields"]);
    assert.match(spec, /UserRequest:[^;]*ttr_escalation_deadline/);
    assert.doesNotMatch(spec, /Incident:[^;]*ttr_escalation_deadline/);
  });
});
