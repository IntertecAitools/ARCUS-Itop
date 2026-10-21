import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { mapLimited, newestRows, ObjectsService, pageFromEnd, SORT_ROW_CAP } from "../src/platform/objects/objects.service.js";
import { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import { FakeItopClient, getResponse, sampleSchema } from "./helpers.js";

/**
 * Behaviour that only shows at realistic volume (docs/performance.md):
 * tens of thousands of tickets, where every iTop call costs ~0.5 s and iTop
 * returns rows oldest first.
 */

describe("pageFromEnd", () => {
  // iTop's order: rows 1..total, oldest first.
  const fetcher = (total: number, limit: number, seen: number[] = []) => async (page: number) => {
    seen.push(page);
    const from = (page - 1) * limit + 1;
    return Array.from({ length: Math.max(0, Math.min(limit, total - from + 1)) }, (_, i) => from + i);
  };

  it("returns the newest rows first, from at most two iTop pages", async () => {
    const seen: number[] = [];
    // 103 rows, 10 a page: the newest ten are 94..103, on iTop pages 10 and 11.
    assert.deepEqual(await pageFromEnd(103, 1, 10, fetcher(103, 10, seen)), [103, 102, 101, 100, 99, 98, 97, 96, 95, 94]);
    assert.deepEqual(seen.sort((a, b) => a - b), [10, 11]);
  });

  it("walks back page by page and ends with the oldest rows", async () => {
    assert.deepEqual(await pageFromEnd(103, 2, 10, fetcher(103, 10)), [93, 92, 91, 90, 89, 88, 87, 86, 85, 84]);
    assert.deepEqual(await pageFromEnd(103, 11, 10, fetcher(103, 10)), [3, 2, 1]);
    assert.deepEqual(await pageFromEnd(103, 12, 10, fetcher(103, 10)), []);
  });

  it("reads a single page when the boundaries line up", async () => {
    const seen: number[] = [];
    assert.deepEqual(await pageFromEnd(100, 1, 10, fetcher(100, 10, seen)), [100, 99, 98, 97, 96, 95, 94, 93, 92, 91]);
    assert.deepEqual(seen, [10]);
  });
});

describe("mapLimited", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimited([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30]);
    assert.equal(peak, 2);
  });
});

describe("ObjectsService.listAll at volume", () => {
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ class: "Server", id: from + i, fields: { id: String(from + i) } }));

  it("asks for no more than the cap when it is under a page", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse(rows(1, 4), 300));
    const result = await new ObjectsService(fake.asClient(), sampleSchema(), "test").listAll("Server", { fields: "id" }, 4);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.params["limit"], 4);
    assert.equal(result.items.length, 4);
    assert.equal(result.truncated, true);
    assert.equal(result.total, 300);
  });

  it("reads the remaining pages in parallel once page 1 gives the total", async () => {
    let inFlight = 0;
    let peak = 0;
    const fake = new FakeItopClient().on("core/get", (params) => {
      const page = Number(params["page"]);
      return getResponse(rows((page - 1) * 500 + 1, 500), 3000);
    });
    const client = fake.asClient();
    const slow = {
      ...client,
      call: async (...args: Parameters<typeof client.call>) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return client.call(...args);
      },
    } as typeof client;
    const result = await new ObjectsService(slow, sampleSchema(), "test").listAll("Server", { fields: "id" }, 3000);
    assert.equal(result.items.length, 3000);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      fake.calls.map((c) => c.params["page"]).sort((a, b) => Number(a) - Number(b)),
      [1, 2, 3, 4, 5, 6],
    );
    assert.ok(peak > 1, "pages after the first go out together");
    assert.ok(peak <= 4, "but not all at once");
  });

  it("lets an internal scan read bigger pages, up to 2,000 rows", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse(rows(1, 10), 10));
    await new ObjectsService(fake.asClient(), sampleSchema(), "test").listAll("Server", { fields: "id" }, 20_000, 50_000);
    assert.equal(fake.calls[0]!.params["limit"], 2000);
  });
});

describe("newestRows", () => {
  // 1,000 rows with ids 1..1000, served in either of iTop's orders.
  const served = (descending: boolean) => {
    const pages: number[] = [];
    const fetch = async (page: number, limit: number) => {
      pages.push(page);
      const ids = Array.from({ length: 1000 }, (_, i) => (descending ? 1000 - i : i + 1));
      return { rows: ids.slice((page - 1) * limit, page * limit).map((id) => ({ id })), total: 1000 };
    };
    return { fetch, pages };
  };

  it("finds the newest when iTop lists newest first (UserRequest, events)", async () => {
    const { fetch } = served(true);
    const { rows, total } = await newestRows(5, fetch);
    assert.deepEqual(rows.map((r) => r.id), [1000, 999, 998, 997, 996]);
    assert.equal(total, 1000);
  });

  it("finds the newest when iTop lists oldest first (Ticket)", async () => {
    const { fetch, pages } = served(false);
    const { rows } = await newestRows(5, fetch);
    assert.deepEqual(rows.map((r) => r.id), [1000, 999, 998, 997, 996]);
    assert.ok(pages.length <= 3, "page 1, then at most two pages from the end");
  });

  it("reads one page when everything fits", async () => {
    const pages: number[] = [];
    const { rows } = await newestRows(5, async (page) => {
      pages.push(page);
      return { rows: [{ id: 2 }, { id: 9 }, { id: 4 }], total: 3 };
    });
    assert.deepEqual(rows.map((r) => r.id), [9, 4, 2]);
    assert.deepEqual(pages, [1]);
  });
});

describe("sorting a big list", () => {
  it("refuses from a one-row count, without downloading the capped set", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 50_000));
    await assert.rejects(
      () => new ObjectsService(fake.asClient(), sampleSchema(), "test").list("Server", { page: 1, limit: 25, sort: "name" }),
      (error: unknown) => error instanceof AppError && error.status === 400 && /50000 rows match/.test(error.message),
    );
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.params["limit"], 1);
  });

  it("still sorts a set under the cap", async () => {
    const rows = [3, 1, 2].map((id) => ({ class: "Server", id, fields: { id: String(id), name: `srv-${id}` } }));
    const fake = new FakeItopClient().on("core/get", getResponse(rows, 3));
    const result = await new ObjectsService(fake.asClient(), sampleSchema(), "test").list("Server", {
      page: 1,
      limit: 25,
      sort: "name",
      order: "desc",
    });
    assert.deepEqual(result.items.map((i) => i.id), [3, 2, 1]);
    assert.ok(SORT_ROW_CAP >= 2000);
  });
});

describe("DashboardService.overview at volume", () => {
  it("counts the SLA split in iTop and reads the window without the stopwatch flags", async () => {
    const scans: Array<{ oql: string; fields: string }> = [];
    const total = (oql: string) =>
      /sla_tto_passed = 1 AND sla_ttr_passed = 0/.test(oql) ? 50 : /start_date >= .* AND sla_ttr_passed = 1/.test(oql) ? 100 : 6000;
    const objects = {
      timeZone: "Europe/Paris",
      async list(_className: string, query: { oql: string }) {
        return { items: [], total: total(query.oql), page: 1, limit: 1, pages: 1, hasMore: false, sortedInBff: false };
      },
      async listAll(_className: string, query: { oql: string; fields: string }) {
        scans.push(query);
        return { items: [], total: 0, truncated: false };
      },
    } as unknown as ObjectsService;

    const overview = await new DashboardService(objects).overview("90d");

    assert.deepEqual(overview.sla, { compliance: 5850 / 6000, onTime: 5850, atRisk: 50, breached: 100 });
    const window = scans.find((s) => s.oql.startsWith("SELECT Incident WHERE start_date >="))!;
    assert.ok(!/sla_/.test(window.fields), window.fields);
  });
});
