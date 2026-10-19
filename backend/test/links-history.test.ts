import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { describe as describeOp, HistoryService } from "../src/platform/history/history.service.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, SAMPLE_RAW_SCHEMA } from "./helpers.js";

/**
 * Link-set editing and record history.
 *
 * Team.persons_list is the n-n case (rows of lnkPersonToTeam, which has a
 * third key, role_id -- why remote_key must come from the datamodel), and
 * Problem.related_incident_list the 1-n case.
 */
const schema = CmdbSchema.fromRaw({
  ...SAMPLE_RAW_SCHEMA,
  Person: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["name"],
    readonly: [],
    fields: { name: { type: "String", ui: "scalar", owner: "Person", required: true } },
  },
  Team: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["name"],
    readonly: [],
    fields: {
      name: { type: "String", ui: "scalar", owner: "Team", required: true },
      persons_list: {
        type: "LinkedSetIndirect",
        ui: "related",
        owner: "Team",
        linked: "lnkPersonToTeam",
        link_key: "team_id",
        remote_key: "person_id",
      },
      locked_list: {
        type: "LinkedSetIndirect",
        ui: "related",
        owner: "Team",
        linked: "lnkPersonToTeam",
        link_key: "team_id",
        remote_key: "person_id",
        edit_mode: "none",
      },
    },
  },
  lnkPersonToTeam: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["team_id", "person_id", "role_id"],
    readonly: [],
    fields: {
      team_id: { type: "ExternalKey", ui: "picker", owner: "lnkPersonToTeam", target: "Team", required: true },
      person_id: { type: "ExternalKey", ui: "picker", owner: "lnkPersonToTeam", target: "Person", required: true },
      role_id: { type: "ExternalKey", ui: "picker", owner: "lnkPersonToTeam", target: "Organization" },
    },
  },
  Problem: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["title"],
    readonly: [],
    fields: {
      title: { type: "String", ui: "scalar", owner: "Problem", required: true },
      related_incident_list: {
        type: "LinkedSet",
        ui: "related",
        owner: "Problem",
        linked: "Incident",
        link_key: "parent_problem_id",
        edit_mode: "add_remove",
      },
    },
  },
  Incident: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["title", "parent_problem_id"],
    readonly: [],
    fields: {
      title: { type: "String", ui: "scalar", owner: "Incident", required: true },
      parent_problem_id: { type: "ExternalKey", ui: "picker", owner: "Incident", target: "Problem" },
    },
  },
});

const service = (fake: FakeItopClient) => new ObjectsService(fake.asClient(), schema, "test");
const created = (cls: string, id: number) => getResponse([{ class: cls, id, fields: {} }]);

describe("ObjectsService.addLink", () => {
  it("creates a link row pointing at both sides for an n-n set", async () => {
    const fake = new FakeItopClient().on("core/create", created("lnkPersonToTeam", 50));
    await service(fake).addLink("Team", 3, "persons_list", 9);
    const call = fake.lastCall();
    assert.equal(call.verb, "core/create");
    assert.equal(call.params["class"], "lnkPersonToTeam");
    assert.deepEqual(call.params["fields"], { team_id: 3, person_id: 9 });
  });

  it("points the far object at this record for a 1-n set", async () => {
    const fake = new FakeItopClient().on("core/update", created("Incident", 12));
    await service(fake).addLink("Problem", 4, "related_incident_list", 12);
    const call = fake.lastCall();
    assert.equal(call.params["class"], "Incident");
    assert.equal(call.params["key"], 12);
    assert.deepEqual(call.params["fields"], { parent_problem_id: 4 });
  });

  it("refuses a set the datamodel marks read-only", async () => {
    await assert.rejects(
      () => service(new FakeItopClient()).addLink("Team", 3, "locked_list", 9),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });
});

describe("ObjectsService.removeLink", () => {
  it("deletes the link row, after checking it belongs to this record", async () => {
    const fake = new FakeItopClient()
      .on("core/get", getResponse([{ class: "lnkPersonToTeam", id: 50, fields: {} }]))
      .on("core/delete", {
        code: 0,
        message: "Deleted: 1",
        objects: { "lnkPersonToTeam::50": { code: 0, message: "", class: "lnkPersonToTeam", key: "50", fields: {} } },
      });
    await service(fake).removeLink("Team", 3, "persons_list", 50);
    assert.equal(fake.calls[0]?.params["key"], "SELECT lnkPersonToTeam WHERE id = 50 AND team_id = 3");
    assert.equal(fake.lastCall().verb, "core/delete");
  });

  it("detaches a 1-n object by clearing its key, not deleting it", async () => {
    const fake = new FakeItopClient()
      .on("core/get", getResponse([{ class: "Incident", id: 12, fields: {} }]))
      .on("core/update", created("Incident", 12));
    await service(fake).removeLink("Problem", 4, "related_incident_list", 12);
    assert.equal(fake.lastCall().verb, "core/update");
    assert.deepEqual(fake.lastCall().params["fields"], { parent_problem_id: 0 });
  });

  it("404s a row that belongs to another record", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => service(fake).removeLink("Team", 3, "persons_list", 77),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );
  });
});

describe("HistoryService", () => {
  const op = (cls: string, id: number, change: number, fields: Record<string, unknown>) => ({
    class: cls,
    id,
    fields: { change: String(change), date: `2026-10-0${change} 10:00:00`, userinfo: "Jane", ...fields },
  });

  it("groups ops by save, newest first, and resolves key names", async () => {
    const fake = new FakeItopClient().on("core/get", [
      getResponse([{ class: "Server", id: 5, fields: {} }]),
      getResponse([
        op("CMDBChangeOpCreate", 1, 1, {}),
        op("CMDBChangeOpSetAttributeScalar", 2, 2, { attcode: "status", oldvalue: "stock", newvalue: "production" }),
        op("CMDBChangeOpSetAttributeScalar", 3, 2, { attcode: "brand_id", oldvalue: "0", newvalue: "7" }),
      ]),
      getResponse([{ class: "Brand", id: 7, fields: { friendlyname: "Dell" } }]),
    ]);

    const history = await new HistoryService(fake.asClient(), schema).forObject("Server", 5);

    assert.equal(fake.calls[1]?.params["class"], "CMDBChangeOp");
    assert.equal(
      fake.calls[1]?.params["key"],
      "SELECT CMDBChangeOp WHERE objclass = 'Server' AND objkey = 5",
    );
    assert.deepEqual(history.items.map((e) => e.id), ["2", "1"]);
    assert.deepEqual(history.items[0]?.changes.map((c) => c.newValue), ["production", "Dell"]);
    assert.equal(history.items[0]?.changes[1]?.oldValue, "(none)");
    assert.equal(history.items[1]?.changes[0]?.text, "Created");
  });

  it("describes link and case-log changes in words", () => {
    const info = schema.require("Team");
    const added = describeOp(info, {
      class: "CMDBChangeOpSetAttributeLinksAddRemove",
      id: 1,
      code: 0,
      message: "",
      fields: { attcode: "persons_list", type: "added", item_class: "Person", item_id: "9" },
    });
    assert.equal(added.kind, "link_added");
    assert.match(added.text, /added Person #9/);
  });
});
