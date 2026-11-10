import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { ServiceLevelsService } from "../src/modules/service-levels/index.js";
import type { ItopResult } from "../src/itop/types.js";
import { FakeItopClient, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

type Tables = Record<string, Record<string, Record<string, unknown>>>;

const ok = (objects: Record<string, { fields: Record<string, unknown> }> = {}) =>
  ({
    code: 0,
    message: "",
    objects: Object.fromEntries(
      Object.entries(objects).map(([k, o]) => {
        const [cls, id] = k.split("::");
        return [k, { code: 0, message: "", class: cls, key: id, fields: o.fields }];
      }),
    ),
  }) as unknown as ItopResult;

/** core/get answers per class, filtered by the simple WHEREs the service writes. */
function itop(tables: Tables) {
  return new FakeItopClient()
    .on("core/get", (params) => {
      const cls = String(params["class"]);
      const oql = String(params["key"]);
      const rows = Object.entries(tables[cls] ?? {});
      const conditions = [...oql.matchAll(/(\w+) = (\d+)/g)].map((m) => [m[1]!, m[2]!] as const);
      const inList = /id IN \(([\d,]+)\)/.exec(oql)?.[1]?.split(",");
      const kept = rows.filter(
        ([id, f]) =>
          conditions.every(([field, value]) => (field === "id" ? id : String(f[field] ?? "")) === value) &&
          (!inList || inList.includes(id)),
      );
      return ok(Object.fromEntries(kept.map(([id, fields]) => [`${cls}::${id}`, { fields }])));
    })
    .on("core/create", (params) => ok({ [`${String(params["class"])}::77`]: { fields: {} } }))
    .on("core/update", () => ok())
    .on("core/delete", () => ok());
}

const TABLES: Tables = {
  SLT: {
    "1": { name: "P1 resolve", request_type: "incident", priority: "1", metric: "ttr", value: "4", unit: "hours" },
    "2": { name: "P1 own", request_type: "incident", priority: "1", metric: "tto", value: "15", unit: "minutes" },
  },
  SLA: { "4": { name: "Gold", description: "", org_id: "1", organization_name: "Intertec" } },
  lnkSLAToSLT: { "30": { sla_id: "4", slt_id: "1" }, "31": { sla_id: "4", slt_id: "2" } },
  CustomerContract: {
    "8": {
      name: "Support",
      org_id: "3",
      organization_name: "Acme",
      provider_id: "1",
      provider_name: "Intertec",
      status: "production",
      start_date: "2026-01-01",
      end_date: "",
    },
  },
  lnkCustomerContractToService: {
    "20": { customercontract_id: "8", service_id: "7", service_name: "Email", sla_id: "4", sla_name: "Gold" },
    "21": { customercontract_id: "8", service_id: "9", service_name: "VPN", sla_id: "0", sla_name: "" },
  },
  Service: { "7": { name: "Email" }, "9": { name: "VPN" }, "10": { name: "Laptops" } },
  Organization: { "1": { name: "Intertec" }, "3": { name: "Acme" } },
};

const writes = (fake: FakeItopClient) => fake.calls.filter((c) => c.verb !== "core/get");

describe("ServiceLevelsService", () => {
  it("lists targets, SLAs with their targets, and contracts with each service's SLA", async () => {
    const result = await new ServiceLevelsService(itop(TABLES).asClient()).overview();
    assert.deepEqual(
      result.targets.map((t) => [t.id, t.metric, t.value, t.unit, t.usedBy]),
      [
        ["2", "tto", 15, "minutes", 1],
        ["1", "ttr", 4, "hours", 1],
      ],
    );
    assert.deepEqual(result.slas, [
      { id: "4", name: "Gold", description: "", providerId: "1", providerName: "Intertec", targetIds: ["1", "2"], usedBy: 1 },
    ]);
    const [contract] = result.contracts;
    assert.equal(contract!.customerName, "Acme");
    assert.equal(contract!.status, "production");
    assert.deepEqual(contract!.services, [
      { id: "20", serviceId: "7", serviceName: "Email", slaId: "4", slaName: "Gold" },
      { id: "21", serviceId: "9", serviceName: "VPN", slaId: "", slaName: "" },
    ]);
    assert.deepEqual(result.services.map((s) => s.name), ["Email", "Laptops", "VPN"]);
  });

  it("writes an SLA's targets as its whole set", async () => {
    const fake = itop(TABLES);
    await new ServiceLevelsService(fake.asClient()).updateSla("4", {
      name: " Gold ",
      description: "",
      providerId: "1",
      targetIds: ["1", "1"],
    });
    const [call] = writes(fake);
    assert.equal(call!.verb, "core/update");
    assert.deepEqual(call!.params["fields"], { name: "Gold", description: "", org_id: 1, slts_list: [{ slt_id: 1 }] });
  });

  it("refuses an SLA with an unknown target and writes nothing", async () => {
    const fake = itop(TABLES);
    await assert.rejects(
      new ServiceLevelsService(fake.asClient()).createSla({ name: "X", description: "", providerId: "1", targetIds: ["99"] }),
      /Unknown target/,
    );
    assert.equal(writes(fake).length, 0);
  });

  it("moves contract services to no SLA before deleting the SLA", async () => {
    const fake = itop(TABLES);
    const result = await new ServiceLevelsService(fake.asClient()).deleteSla("4");
    assert.deepEqual(result, { detached: 1 });
    assert.deepEqual(
      writes(fake).map((c) => [c.verb, c.params["class"], c.params["key"], c.params["fields"]]),
      [
        ["core/update", "lnkCustomerContractToService", 20, { sla_id: 0 }],
        ["core/delete", "SLA", 4, undefined],
      ],
    );
  });

  it("adds a service to a contract with its SLA, once", async () => {
    const fake = itop(TABLES);
    const service = new ServiceLevelsService(fake.asClient());
    await service.addContractService("8", { serviceId: "10", slaId: "4" });
    assert.deepEqual(writes(fake)[0]!.params["fields"], { customercontract_id: 8, service_id: 10, sla_id: 4 });
    await assert.rejects(service.addContractService("8", { serviceId: "7", slaId: "" }), /already on this contract/);
  });

  it("sets and clears the SLA of a contract service", async () => {
    const fake = itop(TABLES);
    const service = new ServiceLevelsService(fake.asClient());
    await service.setContractServiceSla("21", "4");
    await service.setContractServiceSla("20", "");
    assert.deepEqual(
      writes(fake).map((c) => [c.params["key"], c.params["fields"]]),
      [
        [21, { sla_id: 4 }],
        [20, { sla_id: 0 }],
      ],
    );
  });

  it("answers 404 for a missing contract, SLA or service", async () => {
    const service = new ServiceLevelsService(itop(TABLES).asClient());
    await assert.rejects(service.addContractService("99", { serviceId: "7", slaId: "" }), /Contract 99 was not found/);
    await assert.rejects(service.setContractServiceSla("20", "99"), /SLA 99 was not found/);
    await assert.rejects(service.deleteTarget("99"), /Target 99 was not found/);
  });

  it("writes a contract's customer, provider, status and dates", async () => {
    const fake = itop(TABLES);
    await new ServiceLevelsService(fake.asClient()).createContract({
      name: "Acme 2027",
      customerId: "3",
      providerId: "1",
      status: "implementation",
      startDate: "2027-01-01",
      endDate: "",
    });
    assert.deepEqual(writes(fake)[0]!.params["fields"], {
      name: "Acme 2027",
      org_id: 3,
      provider_id: 1,
      status: "implementation",
      start_date: "2027-01-01",
      end_date: "",
    });
  });
});

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

describe("service-levels routes", () => {
  it("rejects bad input with 400 and no iTop call", async () => {
    const fake = new FakeItopClient();
    const server = app(fake);
    const base = "/api/admin/service-levels";
    const target = { name: "P1", requestType: "incident", priority: "1", metric: "ttr", value: 4, unit: "hours" };
    const contract = { name: "C", customerId: "3", providerId: "1" };
    const cases = [
      { method: "POST" as const, url: `${base}/targets`, payload: { ...target, value: 0 } },
      { method: "POST" as const, url: `${base}/targets`, payload: { ...target, value: 1.5 } },
      { method: "POST" as const, url: `${base}/targets`, payload: { ...target, priority: "5" } },
      { method: "POST" as const, url: `${base}/targets`, payload: { ...target, metric: "ttx" } },
      { method: "PUT" as const, url: `${base}/targets/abc`, payload: target },
      { method: "POST" as const, url: `${base}/slas`, payload: { name: "Gold", providerId: "" } },
      { method: "POST" as const, url: `${base}/slas`, payload: { name: " ", providerId: "1" } },
      { method: "POST" as const, url: `${base}/slas`, payload: { name: "Gold", providerId: "1", targetIds: ["x"] } },
      { method: "POST" as const, url: `${base}/contracts`, payload: { ...contract, customerId: "" } },
      { method: "POST" as const, url: `${base}/contracts`, payload: { ...contract, startDate: "2026-02-30" } },
      { method: "POST" as const, url: `${base}/contracts`, payload: { ...contract, startDate: "2027-01-01", endDate: "2026-01-01" } },
      { method: "POST" as const, url: `${base}/contracts`, payload: { ...contract, status: "draft" } },
      { method: "POST" as const, url: `${base}/contracts/8/services`, payload: { serviceId: "", slaId: "" } },
      { method: "PUT" as const, url: `${base}/contract-services/20`, payload: { slaId: "gold" } },
      { method: "DELETE" as const, url: `${base}/contract-services/x` },
    ];
    for (const c of cases) {
      const response = await server.inject(c);
      assert.equal(response.statusCode, 400, `${c.method} ${c.url} ${JSON.stringify(c.payload ?? "")}`);
    }
    assert.equal(fake.calls.length, 0);
  });
});
