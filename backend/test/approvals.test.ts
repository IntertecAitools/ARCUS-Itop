import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import type { ItopClient } from "../src/itop/client.js";
import { APPROVE_SCRIPT, ApprovalsService, parseSteps } from "../src/platform/approvals/approvals.service.js";
import { phpList, phpUnserialize } from "../src/shared/php-unserialize.js";

/** PHP's serialize() for plain data, so fixtures read as data. */
function php(value: unknown): string {
  if (value === null || value === undefined) return "N;";
  if (typeof value === "boolean") return `b:${value ? 1 : 0};`;
  if (typeof value === "number") return Number.isInteger(value) ? `i:${value};` : `d:${value};`;
  if (typeof value === "string") return `s:${Buffer.byteLength(value)}:"${value}";`;
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value as object);
  return `a:${entries.length}:{${entries.map(([k, v]) => php(k) + php(v)).join("")}}`;
}

describe("phpUnserialize", () => {
  it("reads plain data, counting string lengths in bytes", () => {
    assert.deepEqual(phpUnserialize('a:3:{i:0;s:5:"Zoë!";s:1:"n";N;s:1:"b";b:1;}'), { "0": "Zoë!", n: null, b: true });
    assert.equal(phpUnserialize("d:1.5;"), 1.5);
    assert.deepEqual(phpList(phpUnserialize(php(["a", "b"]))), ["a", "b"]);
  });

  it("refuses objects and malformed data", () => {
    assert.throws(() => phpUnserialize('O:8:"stdClass":0:{}'), AppError);
    assert.throws(() => phpUnserialize('s:9:"short";'), AppError);
    assert.throws(() => phpUnserialize("i:1;junk"), AppError);
  });

  it("parses the steps the extension stores (as read from iTop 3.4)", () => {
    const raw =
      'a:2:{i:0;a:7:{s:11:"timeout_sec";i:0;s:15:"timeout_approve";b:0;s:14:"exit_condition";i:3;s:22:"reuse_previous_answers";b:1;' +
      's:6:"status";s:7:"ongoing";s:9:"approvers";a:1:{i:0;a:3:{s:5:"class";s:6:"Person";s:2:"id";s:2:"13";s:8:"passcode";i:48200;}}' +
      's:7:"started";i:1792688611;}i:1;a:6:{s:11:"timeout_sec";i:0;s:15:"timeout_approve";b:0;s:14:"exit_condition";i:3;' +
      's:22:"reuse_previous_answers";b:1;s:6:"status";s:4:"idle";s:9:"approvers";a:1:{i:0;a:3:{s:5:"class";s:6:"Person";' +
      's:2:"id";s:1:"1";s:8:"passcode";i:85008;}}}}';
    const steps = parseSteps(raw);
    assert.equal(steps.length, 2);
    assert.equal(steps[0]!.status, "ongoing");
    assert.deepEqual(steps[0]!.approvers[0], { class: "Person", id: 13, passcode: "48200", comment: "", forward: [] });
    assert.equal(steps[1]!.approvers[0]!.id, 1);
  });
});

/* ------------------------------------------------------------------------ */

interface SchemeRow {
  id: number;
  obj_key: number;
  status: "ongoing" | "accepted" | "rejected";
  current_step: number;
  steps: unknown[];
}

const approver = (id: number, passcode: number, extra: Record<string, unknown> = {}) => ({
  class: "Person",
  id: String(id),
  passcode,
  ...extra,
});

/** A small iTop: approval schemes, requests and contacts, plus approve.php. */
function fakeItop(schemes: SchemeRow[]) {
  const posts: Array<{ script: string; params: Record<string, string> }> = [];
  let onPost: (params: Record<string, string>) => void = () => {};
  const rowsFor = (cls: string, oql: string) => {
    if (cls === "ApprovalScheme") {
      let hits = schemes;
      const id = / id = (\d+)/.exec(oql)?.[1];
      if (id) hits = hits.filter((s) => s.id === Number(id));
      if (oql.includes("status = 'ongoing'")) hits = hits.filter((s) => s.status === "ongoing");
      const key = /obj_key = (\d+)/.exec(oql)?.[1];
      if (key) hits = hits.filter((s) => s.obj_key === Number(key));
      return hits.map((s) => ({
        id: s.id,
        fields: {
          obj_class: "UserRequest",
          obj_key: String(s.obj_key),
          status: s.status,
          current_step: String(s.current_step),
          steps: php(s.steps),
          started: "2026-10-22 10:00:00",
          ended: s.status === "ongoing" ? "" : "2026-10-22 11:00:00",
        },
      }));
    }
    if (cls === "UserRequest") {
      const ids = /IN \(([\d,]+)\)/.exec(oql)![1]!.split(",").map(Number);
      return ids.map((id) => ({
        id,
        fields: { ref: `R-${id}`, title: `Request ${id}`, description: "<p>Need &amp; want</p>", caller_id_friendlyname: "Eve" },
      }));
    }
    if (cls === "Contact") {
      const ids = /IN \(([\d,]+)\)/.exec(oql)![1]!.split(",").map(Number);
      return ids.map((id) => ({ id, fields: { friendlyname: `Person ${id}` } }));
    }
    throw new Error(`unexpected class ${cls}`);
  };
  const client = {
    async call(_verb: string, params: Record<string, unknown>, options: { asService?: boolean } = {}) {
      assert.equal(options.asService, true, "approvals are read as the service account");
      const rows = rowsFor(String(params["class"]), String(params["key"]));
      return {
        code: 0,
        message: `Found: ${rows.length}`,
        objects: Object.fromEntries(
          rows.map((r) => [`X::${r.id}`, { code: 0, message: "", class: String(params["class"]), key: String(r.id), fields: r.fields }]),
        ),
      };
    },
    async postScript(script: string, params: Record<string, string>) {
      posts.push({ script, params });
      onPost(params);
      return new Response("<html><body><p>Your answer has been recorded.</p></body></html>");
    },
  };
  return {
    client: client as unknown as ItopClient,
    posts,
    schemes,
    whenPosted(fn: (params: Record<string, string>) => void) {
      onPost = fn;
    },
  };
}

const me = (contactId: number) => ({ userId: 9, login: "pia", contactId, kind: "portal" }) as Caller;

const twoLevels = (): SchemeRow => ({
  id: 1,
  obj_key: 33,
  status: "ongoing",
  current_step: 0,
  steps: [
    { status: "ongoing", approvers: [approver(13, 48200), approver(14, 11111, { forward: [approver(20, 22222)] })] },
    { status: "idle", approvers: [approver(1, 85008)] },
  ],
});

describe("ApprovalsService", () => {
  it("lists only the approvals waiting for the caller, with the request", async () => {
    const itop = fakeItop([twoLevels(), { ...twoLevels(), id: 2, obj_key: 34, steps: [{ status: "ongoing", approvers: [approver(99, 1)] }] }]);
    const service = new ApprovalsService(itop.client, "UTC");
    const list = await runAs(me(13), () => service.list("pending"));
    assert.equal(list.pending, 1);
    assert.equal(list.items.length, 1);
    assert.deepEqual(
      { id: list.items[0]!.id, level: list.items[0]!.level, levels: list.items[0]!.levels, ref: list.items[0]!.request.ref },
      { id: 1, level: 1, levels: 2, ref: "R-33" },
    );
    // Level 2's approver is not asked yet; a substitute is, alongside the approver they stand in for.
    assert.equal((await runAs(me(1), () => service.list("pending"))).pending, 0);
    assert.equal((await runAs(me(20), () => service.pendingCount())), 1);
  });

  it("shows an approval only to its approvers", async () => {
    const service = new ApprovalsService(fakeItop([twoLevels()]).client, "UTC");
    const detail = await runAs(me(1), () => service.get(1));
    assert.equal(detail.description, "Need & want");
    assert.deepEqual(
      detail.steps.map((s) => [s.level, s.status, s.approvers.map((a) => a.name)]),
      [
        [1, "in_progress", ["Person 13", "Person 14"]],
        [2, "waiting", ["Person 1"]],
      ],
    );
    await assert.rejects(runAs(me(77), () => service.get(1)), (e: AppError) => e.code === "not_found");
    await assert.rejects(runAs(me(0), () => service.get(1)), (e: AppError) => e.code === "not_found");
  });

  it("answers through approve.php with the caller's own token, then reads the result back", async () => {
    const itop = fakeItop([twoLevels()]);
    itop.whenPosted(() => {
      const step = itop.schemes[0]!.steps[0] as { approvers: Record<string, unknown>[] };
      Object.assign(step.approvers[0]!, { approval: true, answer_time: 1792688700, comment: "ok" });
    });
    const service = new ApprovalsService(itop.client, "UTC");
    const detail = await runAs(me(13), () => service.answer(1, "approved", " ok "));
    assert.deepEqual(itop.posts, [
      { script: APPROVE_SCRIPT, params: { operation: "do_approve", token: "1-0-Person-13-48200", comment: "ok" } },
    ]);
    assert.equal(detail.awaitingMe, false);
    assert.deepEqual(detail.myAnswer, { decision: "approved", comment: "ok", at: new Date(1792688700_000).toISOString() });
  });

  it("lets a substitute answer with the substitute's passcode", async () => {
    const itop = fakeItop([twoLevels()]);
    itop.whenPosted(() => {
      const step = itop.schemes[0]!.steps[0] as { approvers: Record<string, unknown>[] };
      Object.assign(step.approvers[1]!, { approval: false, answer_time: 1792688800, comment: "no", replier_index: 0 });
    });
    const service = new ApprovalsService(itop.client, "UTC");
    const detail = await runAs(me(20), () => service.answer(1, "rejected", "no"));
    assert.equal(itop.posts[0]!.params["token"], "1-0-Person-20-22222");
    assert.equal(itop.posts[0]!.params["operation"], "do_reject");
    assert.equal(detail.steps[0]!.approvers[1]!.answeredBy, "Person 20");
    assert.equal(detail.myAnswer?.decision, "rejected");
  });

  it("refuses a rejection without a comment, a second answer, and someone else's approval", async () => {
    const itop = fakeItop([twoLevels()]);
    const service = new ApprovalsService(itop.client, "UTC");
    await assert.rejects(runAs(me(13), () => service.answer(1, "rejected", "  ")), (e: AppError) => e.code === "bad_request");
    await assert.rejects(runAs(me(1), () => service.answer(1, "approved", "")), (e: AppError) => e.code === "conflict");
    await assert.rejects(runAs(me(77), () => service.answer(1, "approved", "")), (e: AppError) => e.code === "not_found");
    itop.schemes[0]!.status = "rejected";
    await assert.rejects(
      runAs(me(13), () => service.answer(1, "approved", "")),
      (e: AppError) => e.code === "conflict" && /already rejected/.test(e.message),
    );
    assert.equal(itop.posts.length, 0);
  });

  it("reports iTop's own words when the answer was not recorded", async () => {
    const service = new ApprovalsService(fakeItop([twoLevels()]).client, "UTC");
    await assert.rejects(
      runAs(me(13), () => service.answer(1, "approved", "")),
      (e: AppError) => e.code === "upstream_error" && /Your answer has been recorded/.test(e.message),
    );
  });

  it("gives the approval on a request, newest first, without passcodes", async () => {
    const decided: SchemeRow = { ...twoLevels(), status: "accepted" };
    const service = new ApprovalsService(fakeItop([decided, { ...twoLevels(), id: 5 }]).client, "UTC");
    const approval = await runAs(me(13), () => service.forRequest(33));
    assert.equal(approval?.id, 5);
    assert.equal(JSON.stringify(approval).includes("48200"), false);
    assert.equal(await runAs(me(13), () => service.forRequest(999)), null);
  });
});
