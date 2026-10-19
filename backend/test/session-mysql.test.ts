import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Caller } from "../src/core/request-context.js";
import { MySqlSessionStore, type SqlPool } from "../src/platform/auth/session.mysql.js";

const SECRET = "a-test-secret-that-is-long-enough-0123456789";
const HOUR = 3_600_000;

const jane: Caller = {
  userId: 7,
  login: "jane",
  contactId: 3,
  name: "Jane Doe",
  email: "jane@example.test",
  kind: "staff",
  profiles: ["Service Desk Agent"],
  isAdmin: false,
  allowedOrgIds: [],
  orgId: 1,
  credentials: { user: "jane", password: "s3cret-pass" },
};

interface Row {
  id_hash: string;
  user_id: number;
  data: Buffer;
  created_at: number;
  last_seen: number;
}

/** Just enough of MySQL for the statements the store issues. */
class FakePool implements SqlPool {
  readonly rows = new Map<string, Row>();
  readonly statements: string[] = [];

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const verb = sql.trim().split(/\s+/)[0]!.toUpperCase();
    this.statements.push(verb);
    const v = values as [any, any, any, any, any];
    if (verb === "INSERT") {
      this.rows.set(v[0], { id_hash: v[0], user_id: v[1], data: v[2], created_at: v[3], last_seen: v[4] });
    } else if (verb === "SELECT") {
      const row = this.rows.get(v[0]);
      return [row ? [row] : [], undefined];
    } else if (verb === "UPDATE") {
      const row = this.rows.get(v[1]);
      if (row && sql.includes("last_seen")) row.last_seen = v[0];
      else if (row) row.data = v[0];
    } else if (verb === "DELETE") {
      for (const [k, row] of this.rows) {
        if (sql.includes("user_id") ? row.user_id === v[0] : sql.includes("last_seen <") ? row.last_seen < v[0] || row.created_at < v[1] : k === v[0]) {
          this.rows.delete(k);
        }
      }
    }
    return [[], undefined];
  }

  async end(): Promise<void> {}
}

function store(pool: FakePool, clock: { t: number }, secret = SECRET) {
  return new MySqlSessionStore(pool, secret, HOUR, 12 * HOUR, () => clock.t);
}

describe("MySqlSessionStore", () => {
  it("keeps a session across a restart: a new BFF process reads it back", async () => {
    const pool = new FakePool();
    const clock = { t: 1_000_000 };
    const id = await store(pool, clock).create(jane);

    // A new store over the same database is what a restarted BFF is.
    const after = await store(pool, clock).get(id);
    assert.deepEqual(after, jane);
  });

  it("writes neither the cookie nor the password in readable form", async () => {
    const pool = new FakePool();
    const id = await store(pool, { t: 0 }).create(jane);
    const [row] = [...pool.rows.values()];
    assert.ok(row);
    assert.notEqual(row.id_hash, id);
    assert.match(row.id_hash, /^[0-9a-f]{64}$/);
    assert.ok(!row.data.toString("latin1").includes("s3cret-pass"));
    assert.ok(!row.data.toString("latin1").includes("jane@example"));
  });

  it("refuses a session sealed under another secret, and removes it", async () => {
    const pool = new FakePool();
    const clock = { t: 0 };
    const id = await store(pool, clock).create(jane);
    assert.equal(await store(pool, clock, "another-secret-that-is-long-enough-987654").get(id), undefined);
    assert.equal(pool.rows.size, 0);
  });

  it("refuses a tampered row", async () => {
    const pool = new FakePool();
    const clock = { t: 0 };
    const id = await store(pool, clock).create(jane);
    const row = [...pool.rows.values()][0]!;
    row.data[row.data.length - 1]! ^= 0xff;
    assert.equal(await store(pool, clock).get(id), undefined);
  });

  it("ends a session after the idle window and after its maximum life", async () => {
    const pool = new FakePool();
    const clock = { t: 0 };
    const s = store(pool, clock);
    const idle = await s.create(jane);
    clock.t = HOUR + 1;
    assert.equal(await s.get(idle), undefined);

    clock.t = 0;
    const busy = await s.create(jane);
    for (let t = 0; t <= 12 * HOUR; t += HOUR / 2) {
      clock.t = t;
      assert.ok(await s.get(busy), `still live at ${t / HOUR}h`);
    }
    clock.t = 12 * HOUR + 1;
    assert.equal(await s.get(busy), undefined);
  });

  it("writes the idle timer at most once a minute, not on every request", async () => {
    const pool = new FakePool();
    const clock = { t: 0 };
    const s = store(pool, clock);
    const id = await s.create(jane);
    clock.t = 30_000;
    await s.get(id);
    assert.equal(pool.statements.filter((v) => v === "UPDATE").length, 0);
    clock.t = 61_000;
    await s.get(id);
    assert.equal(pool.statements.filter((v) => v === "UPDATE").length, 1);
  });

  it("signs a user out everywhere, and keeps a changed password", async () => {
    const pool = new FakePool();
    const clock = { t: 0 };
    const s = store(pool, clock);
    const a = await s.create(jane);
    await s.update(a, { ...jane, credentials: { user: "jane", password: "new-pass" } });
    assert.equal((await s.get(a))?.credentials?.password, "new-pass");

    const b = await s.create(jane);
    const other = await s.create({ ...jane, userId: 8, login: "bob" });
    await s.deleteForUser(7);
    assert.equal(await s.get(a), undefined);
    assert.equal(await s.get(b), undefined);
    assert.ok(await s.get(other));
  });
});

describe("MySqlSessionStore row binding", () => {
  it("does not let a copied sealed session open under another cookie", async () => {
    const pool = new FakePool();
    const clock = { t: 0 };
    const s = store(pool, clock);
    const admin = await s.create({ ...jane, userId: 1, login: "admin", isAdmin: true });
    const mine = await s.create({ ...jane, userId: 9, login: "low" });
    const rows = [...pool.rows.values()];
    const adminRow = rows.find((r) => r.user_id === 1)!;
    const myRow = rows.find((r) => r.user_id === 9)!;

    // Someone with write access to the table moves the admin's blob onto
    // their own row, with or without also changing the user id.
    myRow.data = Buffer.from(adminRow.data);
    assert.equal(await s.get(mine), undefined);

    const mine2 = await s.create({ ...jane, userId: 9, login: "low" });
    const row2 = [...pool.rows.values()].find((r) => r.user_id === 9)!;
    row2.data = Buffer.from(adminRow.data);
    row2.user_id = 1;
    assert.equal(await s.get(mine2), undefined);

    assert.equal((await s.get(admin))?.login, "admin");
  });
});
