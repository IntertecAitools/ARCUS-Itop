import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import type { ItopClient } from "../src/itop/client.js";
import { parseImportReport, TransferService } from "../src/platform/transfer/transfer.service.js";
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
].join("\n");

describe("parseImportReport", () => {
  it("reads the counts, every row and iTop's own remarks", () => {
    const report = parseImportReport(REPORT, true);
    assert.deepEqual(report.summary, { issues: 1, warnings: 0, created: 1, updated: 1, unchanged: 0 });
    assert.deepEqual(report.rows.map((r) => r.kind), ["created", "updated", "error"]);
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
