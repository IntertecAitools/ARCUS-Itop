import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

import { buildApp } from "../src/app.js";
import { AppError } from "../src/core/errors.js";
import {
  DataImportService,
  MemoryImportReportStore,
  parseSynchroOutput,
  readTable,
  SyncSourcesService,
} from "../src/modules/data-import/index.js";
import { comparable, mapLimit } from "../src/modules/data-import/import-plan.js";
import { excelDate, guessSeparator } from "../src/modules/data-import/table.js";
import type { ItopResult } from "../src/itop/types.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

/* ------------------------------------------------------------------------- *
 * Reading files
 * ------------------------------------------------------------------------- */

/** A stored-or-deflated zip, as Excel writes an .xlsx. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const WORKBOOK = {
  "xl/workbook.xml": '<workbook><sheets><sheet name="Servers &amp; PCs" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/sharedStrings.xml": "<sst><si><t>name</t></si><si><t>Purchase date</t></si><si><r><t>web</t></r><r><t>-01</t></r></si></sst>",
  "xl/styles.xml":
    '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
    '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
  "xl/worksheets/sheet1.xml":
    "<worksheet><sheetData>" +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>nb_u</t></is></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45658</v></c><c r="C2"><v>2</v></c></row>' +
    '<row r="4"><c r="A4" t="str"><v>db &lt;01&gt;</v></c><c r="B4" s="2"><v>45658.5</v></c></row>' +
    "</sheetData></worksheet>",
};

describe("readTable", () => {
  it("reads a CSV, guessing the separator and dropping a BOM and blank lines", () => {
    const table = readTable("people.csv", Buffer.from('﻿name;email\n\n"Doe; Ann";ann@x.test\nBob;bob@x.test\n'));
    assert.deepEqual(table.headings, ["name", "email"]);
    assert.deepEqual(table.rows, [
      ["Doe; Ann", "ann@x.test"],
      ["Bob", "bob@x.test"],
    ]);
  });

  it("guesses tab and falls back to comma", () => {
    assert.equal(guessSeparator("a\tb\tc"), "\t");
    assert.equal(guessSeparator("single"), ",");
    assert.equal(guessSeparator('"a;b",c'), ",");
  });

  it("reads an .xlsx's first sheet: shared, inline and formula strings, dates, gaps", () => {
    const table = readTable("servers.xlsx", zip(WORKBOOK));
    assert.equal(table.sheet, "Servers & PCs");
    assert.deepEqual(table.headings, ["name", "Purchase date", "nb_u"]);
    assert.deepEqual(table.rows, [
      ["web-01", "2025-01-01", "2"],
      ["db <01>", "2025-01-01 12:00:00", ""],
    ]);
  });

  it("refuses an old .xls and an empty file", () => {
    assert.throws(() => readTable("old.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0])), /\.xlsx or CSV/);
    assert.throws(() => readTable("x.csv", Buffer.alloc(0)), /empty/);
  });

  it("turns Excel serial dates into iTop's text", () => {
    assert.equal(excelDate(45658), "2025-01-01");
    assert.equal(excelDate(45658.25), "2025-01-01 06:00:00");
  });
});

describe("helpers", () => {
  it("compares values the way iTop keeps them", () => {
    const schema = sampleSchema().require("Server");
    assert.equal(comparable(schema.fields["nb_u"], "2"), comparable(schema.fields["nb_u"], 2));
    assert.equal(comparable(schema.fields["org_id"], "0"), "");
    assert.equal(comparable({ ...schema.fields["name"]!, type: "HTML" }, "<p>a &amp; b</p>"), "a & b");
  });

  it("runs work with a concurrency limit, keeping order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running -= 1;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 30, 20]);
    assert.equal(peak, 2);
  });
});

/* ------------------------------------------------------------------------- *
 * The import: plan and run
 * ------------------------------------------------------------------------- */

const EXISTING = [
  { class: "Server", id: 11, fields: { name: "web-01", org_id: "3", org_id_friendlyname: "Acme", nb_u: "2", status: "production" } },
  { class: "Server", id: 12, fields: { name: "db-01", org_id: "3", org_id_friendlyname: "Acme", nb_u: "4", status: "production" } },
];

function importFake(): FakeItopClient {
  return new FakeItopClient()
    .on("core/get", (params) => {
      const key = String(params["key"]);
      if (key.startsWith("SELECT Organization")) {
        return getResponse([{ class: "Organization", id: 3, fields: { name: "Acme" } }]);
      }
      if (key.startsWith("SELECT Server")) return getResponse(EXISTING);
      throw new Error(`unexpected ${key}`);
    })
    .on("core/create", (params) => {
      const fields = params["fields"] as Record<string, unknown>;
      if (fields["name"] === "denied") return { code: 1, message: "Error: Not allowed to create" } as ItopResult;
      return getResponse([{ class: "Server", id: 99, fields: {} }]);
    })
    .on("core/update", getResponse([{ class: "Server", id: 12, fields: {} }]));
}

const REQUEST = {
  fileName: "servers.csv",
  columns: ["name", "org_id->name", "nb_u", null, "status"],
  keys: ["name", "org_id->name"],
  rows: [
    ["web-01", "Acme", "2", "ignored", "production"], // unchanged
    ["web-02", "Acme", "4", "", "production"], // create
    ["db-01", "ACME", "8", "", "stock"], // update: nb_u, status
    ["x", "Nowhere", "1", "", "production"], // unknown organisation
    ["WEB-02", "Acme", "1", "", "production"], // same key as line 3
    ["y", "Acme", "abc", "", "production"], // not an integer
    ["", "Acme", "1", "", "production"], // empty key
    ["z", "Acme", "1", "", "melted"], // not a status
  ],
};

function service(fake = importFake()) {
  return { fake, service: new DataImportService(fake.asClient(), sampleSchema(), new MemoryImportReportStore(), "Europe/Paris") };
}

describe("DataImportService.plan", () => {
  it("previews every row: create, update with its changes, unchanged, and why a row fails", async () => {
    const { fake, service: imports } = service();
    const plan = await imports.plan("Server", REQUEST);
    assert.deepEqual(plan.summary, { create: 1, update: 1, unchanged: 1, error: 5 });
    assert.deepEqual(plan.columns, ["name", "org_id->name", "nb_u", "status"]);
    const [unchanged, create, update, noOrg, dup, notInt, emptyKey, badEnum] = plan.rows;
    assert.equal(unchanged?.action, "unchanged");
    assert.equal(unchanged?.id, 11);
    assert.equal(create?.action, "create");
    assert.equal(create?.line, 3);
    assert.equal(update?.action, "update");
    assert.equal(update?.id, 12);
    assert.deepEqual(update?.changes, [
      { field: "nb_u", from: "4", to: "8" },
      { field: "status", from: "production", to: "stock" },
    ]);
    assert.match(noOrg?.errors[0] ?? "", /No Organization has name "Nowhere"/);
    assert.match(dup?.errors[0] ?? "", /Same key as line 3/);
    assert.match(notInt?.errors[0] ?? "", /integer/);
    assert.match(emptyKey?.errors[0] ?? "", /key column "name" is empty/);
    assert.match(badEnum?.errors[0] ?? "", /"melted" is not one of/);
    assert.equal(update?.key, "name=db-01, org_id->name=ACME");

    // Nothing written; references and matches read in one query each.
    assert.ok(fake.calls.every((c) => c.verb === "core/get"));
    const lookups = fake.calls.map((c) => String(c.params["key"]));
    assert.equal(lookups[0], "SELECT Organization WHERE name IN ('Acme', 'ACME', 'Nowhere')");
    assert.match(lookups[1] ?? "", /^SELECT Server WHERE \(name = 'web-01' AND org_id = 3\) OR /);
    assert.match(String(fake.calls[1]?.params["output_fields"]), /org_id_friendlyname/);
  });

  it("creates every row when no key is chosen, and checks required fields", async () => {
    const { service: imports } = service();
    const plan = await imports.plan("Server", { columns: ["name", "nb_u"], keys: [], rows: [["a", "1"]] });
    assert.equal(plan.rows[0]?.action, "error");
    assert.match(plan.rows[0]?.errors[0] ?? "", /Missing required attribute\(s\) for Server: org_id/);
  });

  it("refuses classes it does not load, unknown or doubled columns, keys that are not columns", async () => {
    const { service: imports } = service();
    const refused = (p: Promise<unknown>, pattern: RegExp) =>
      assert.rejects(p, (e: unknown) => e instanceof AppError && pattern.test(e.message));
    await refused(imports.plan("Brand", { columns: ["name"], keys: [], rows: [["x"]] }), /not a class the import loads/);
    await refused(imports.plan("Server", { columns: ["brand_name"], keys: [], rows: [["x"]] }), /cannot|can be imported/);
    await refused(imports.plan("Server", { columns: ["org_id", "org_id->name"], keys: [], rows: [["1", "x"]] }), /Two columns/);
    await refused(imports.plan("Server", { columns: ["name"], keys: ["nb_u"], rows: [["x"]] }), /not one of the mapped columns/);
    await refused(imports.plan("Server", { columns: [null], keys: [], rows: [["x"]] }), /map at least one/);
  });
});

describe("DataImportService.run", () => {
  it("writes creates and changed fields only, keeps going past a refused row, and keeps the report", async () => {
    const { fake, service: imports } = service();
    const request = {
      ...REQUEST,
      rows: [REQUEST.rows[0]!, REQUEST.rows[1]!, REQUEST.rows[2]!, ["denied", "Acme", "1", "", "production"], REQUEST.rows[3]!],
    };
    const report = await imports.run("Server", request);
    assert.deepEqual(report.summary, { created: 1, updated: 1, unchanged: 1, error: 2 });
    assert.equal(report.rows[1]?.id, 99);
    assert.match(report.rows[3]?.errors[0] ?? "", /Not allowed to create/);

    const create = fake.calls.find((c) => c.verb === "core/create" && (c.params["fields"] as Record<string, unknown>)["name"] === "web-02");
    assert.deepEqual(create?.params["fields"], { name: "web-02", org_id: 3, nb_u: 4, status: "production" });
    assert.equal(create?.params["comment"], "Data import from servers.csv");
    const update = fake.calls.find((c) => c.verb === "core/update");
    assert.equal(update?.params["key"], 12);
    assert.deepEqual(update?.params["fields"], { nb_u: 8, status: "stock" });

    const listed = await imports.listReports();
    assert.equal(listed[0]?.id, report.id);
    assert.equal("rows" in listed[0]!, false);
    const file = await imports.reportCsv(report.id);
    assert.match(file.filename, /^import-Server-\d{4}-\d{2}-\d{2}/);
    assert.match(file.csv, /^﻿Line,Outcome,Record id,Key,Changes,Errors\n/);
    assert.match(file.csv, /3,created,99,/);
    assert.match(file.csv, /nb_u: 4 -> 8; status: production -> stock/);
  });
});

/* ------------------------------------------------------------------------- *
 * Sync sources
 * ------------------------------------------------------------------------- */

const SYNCHRO_OUTPUT = [
  "#------------------------------------------------------------",
  "# Import phase summary",
  "#Data Source: 4",
  "#Issues (before synchro): 1",
  "#Created (before synchro): 2",
  "#Updated (before synchro): 0",
  "3: Error - Failed to reconcile, found 2 rows having '`primary_key` = 'x''",
  "1: New entry, reconciliation: '`primary_key` = 'a''",
  "# Synchronization phase summary",
  "#Objects created: 2 (1 warnings)",
  "#Objects update errors: 0",
  "# No traces. (To activate the traces set \"synchro_trace\" => true in the configuration file)",
].join("\n");

describe("parseSynchroOutput", () => {
  it("reads iTop's counts and keeps errors, dropping the echo and per-row noise", () => {
    const parsed = parseSynchroOutput(SYNCHRO_OUTPUT);
    assert.equal(parsed.counts["Objects created"], 2);
    assert.equal(parsed.counts["Objects created warnings"], 1);
    assert.equal(parsed.counts["Issues (before synchro)"], 1);
    assert.deepEqual(parsed.messages, ["3: Error - Failed to reconcile, found 2 rows having '`primary_key` = 'x''"]);
  });

  it("reads the HTML page the script answers with over HTTP", () => {
    const html =
      "<!DOCTYPE html><html><head><title>Synchro</title></head><body>" +
      SYNCHRO_OUTPUT.split("\n")
        .map((l) => `${l.replace(/'/g, "&#039;")}<br/>`)
        .join("\n") +
      "</body></html>";
    const parsed = parseSynchroOutput(html);
    assert.equal(parsed.counts["Objects created"], 2);
    assert.deepEqual(parsed.messages, ["3: Error - Failed to reconcile, found 2 rows having '`primary_key` = 'x''"]);
  });

  it("turns an answer with no counts into a clear refusal", () => {
    assert.throws(() => parseSynchroOutput("#Unknown data source id: '9'"), /Unknown data source id/);
  });
});

function syncFake(): FakeItopClient {
  const attributes = [
    { class: "SynchroAttribute", id: 1, fields: { attcode: "name", update: "1", reconcile: "1", update_policy: "master_locked" } },
    { class: "SynchroAttExtKey", id: 2, fields: { attcode: "org_id", update: "1", reconcile: "1", update_policy: "master_locked" } },
    { class: "SynchroAttribute", id: 3, fields: { attcode: "nb_u", update: "1", reconcile: "0", update_policy: "master_locked" } },
    { class: "SynchroAttribute", id: 4, fields: { attcode: "status", update: "1", reconcile: "0", update_policy: "master_locked" } },
  ];
  return new FakeItopClient()
    .on("core/create", getResponse([{ class: "SynchroDataSource", id: 4, fields: {} }]))
    .on("core/update", getResponse([{ class: "SynchroAttribute", id: 1, fields: {} }]))
    .on("core/get", (params) => {
      const key = String(params["key"]);
      if (params["class"] === "SynchroDataSource") {
        return getResponse([{ class: "SynchroDataSource", id: 4, fields: { name: "HR feed", scope_class: "Server", status: "implementation" } }]);
      }
      if (key.startsWith("SELECT SynchroAttExtKey")) {
        return getResponse([{ class: "SynchroAttExtKey", id: 2, fields: { attcode: "org_id", reconciliation_attcode: "" } }]);
      }
      if (key.startsWith("SELECT SynchroAttribute")) return getResponse(attributes);
      if (key.startsWith("SELECT SynchroLog")) return getResponse([]);
      throw new Error(`unexpected ${key}`);
    });
}

describe("SyncSourcesService", () => {
  it("defines a source and sets its attributes: keys first, unfed columns left alone, lookups", async () => {
    const fake = syncFake();
    const sources = new SyncSourcesService(fake.asClient(), sampleSchema());
    const detail = await sources.create({
      name: "HR feed",
      targetClass: "Server",
      keys: ["name"],
      columns: ["name", "org_id", "nb_u"],
      lookups: { org_id: "name" },
      deletePolicy: "update",
      deletePolicyUpdate: "status:obsolete",
    });
    assert.equal(detail.id, 4);
    const create = fake.calls.find((c) => c.verb === "core/create");
    assert.equal(create?.params["class"], "SynchroDataSource");
    assert.deepEqual(
      { ...(create?.params["fields"] as Record<string, unknown>) },
      {
        name: "HR feed",
        description: "",
        status: "implementation",
        reconciliation_policy: "use_attributes",
        action_on_zero: "create",
        action_on_one: "update",
        action_on_multiple: "error",
        delete_policy: "update",
        delete_policy_update: "status:obsolete",
        delete_policy_retention: 0,
        full_load_periodicity: 0,
        scope_class: "Server",
      },
    );
    const updates = fake.calls.filter((c) => c.verb === "core/update").map((c) => [c.params["class"], String(c.params["key"]).split("attcode = ")[1], c.params["fields"]]);
    // name is already a key and written: untouched. org_id: no longer a key, matched by name.
    assert.deepEqual(updates, [
      ["SynchroAttExtKey", "'org_id'", { update: 1, reconcile: 0, reconciliation_attcode: "name" }],
      ["SynchroAttribute", "'status'", { update: 0, reconcile: 0 }],
    ]);
  });

  it("refuses inconsistent policies before calling iTop", async () => {
    const fake = syncFake();
    const sources = new SyncSourcesService(fake.asClient(), sampleSchema());
    await assert.rejects(sources.create({ name: "x", targetClass: "Server", keys: [], columns: ["name"] }), /at least one field/);
    await assert.rejects(
      sources.create({ name: "x", targetClass: "Server", keys: ["name"], columns: ["name"], deletePolicy: "update" }),
      /status:obsolete/,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("needs a primary_key column to run, and only the source's columns", async () => {
    const fake = syncFake();
    const sources = new SyncSourcesService(fake.asClient(), sampleSchema());
    await assert.rejects(sources.run(4, { columns: ["name"], rows: [["a"]], simulate: true }), /primary_key/);
    await assert.rejects(sources.run(4, { columns: ["primary_key", "brand"], rows: [["1", "a"]], simulate: true }), /not a column/);
  });
});

/* ------------------------------------------------------------------------- *
 * Routes
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

describe("data-import routes", () => {
  it("lists the classes it loads, reads an upload and previews", async () => {
    const server = app(importFake());
    const classes = await server.inject({ method: "GET", url: "/api/admin/data-import/classes" });
    assert.equal(classes.statusCode, 200);
    // Only the classes the schema has.
    assert.deepEqual(classes.json().classes, [
      { name: "Organization", label: "Organization", defaultKeys: ["name"] },
      { name: "Server", label: "Server", defaultKeys: ["name", "org_id->name"] },
    ]);

    const read = await server.inject({
      method: "POST",
      url: "/api/admin/data-import/read",
      payload: { fileName: "a.csv", content: Buffer.from("name,nb_u\nweb-01,2\n").toString("base64") },
    });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().rows, [["web-01", "2"]]);

    const preview = await server.inject({
      method: "POST",
      url: "/api/admin/data-import/Server/preview",
      payload: { columns: ["name", "org_id->name"], keys: ["name", "org_id->name"], rows: [["web-01", "Acme"]] },
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().rows[0].action, "unchanged");

    const bad = await server.inject({
      method: "POST",
      url: "/api/admin/data-import/Server/preview",
      payload: { columns: ["name; DROP"], keys: [], rows: [["x"]] },
    });
    assert.equal(bad.statusCode, 400);
  });
});
