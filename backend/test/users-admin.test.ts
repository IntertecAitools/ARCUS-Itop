import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import { UsersService } from "../src/platform/admin/users.service.js";
import { AuthService } from "../src/platform/auth/auth.service.js";
import { MemorySessionStore } from "../src/platform/auth/session.store.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { FakeItopClient, getResponse, sampleSchema } from "./helpers.js";

const PROFILES = getResponse([
  { class: "URP_Profiles", id: 1, fields: { name: "Administrator", description: "" } },
  { class: "URP_Profiles", id: 2, fields: { name: "Portal user", description: "" } },
  { class: "URP_Profiles", id: 5, fields: { name: "Service Desk Agent", description: "" } },
  { class: "URP_Profiles", id: 9, fields: { name: "REST Services User", description: "" } },
]);
const USER = (id: number) =>
  getResponse([{ class: "UserLocal", id, fields: { login: "bob", status: "enabled", contactid: "4" } }]);

const admin: Caller = {
  userId: 1,
  login: "admin",
  contactId: 1,
  name: "Admin",
  email: "",
  kind: "staff",
  profiles: ["Administrator"],
  isAdmin: true,
  allowedOrgIds: [],
  orgId: 1,
  credentials: { user: "admin", password: "x" },
};

function build(fake: FakeItopClient) {
  const sessions = new MemorySessionStore(3_600_000, 3_600_000);
  const objects = new ObjectsService(fake.asClient(), sampleSchema(), "test");
  return new UsersService(fake.asClient(), objects, new AuthService(fake.asClient()), sessions);
}

describe("UsersService.create", () => {
  it("adds the REST profile to a staff account, as the signed-in admin", async () => {
    const fake = new FakeItopClient()
      .on("core/get", [PROFILES, USER(20), getResponse([]), getResponse([])])
      .on("core/create", getResponse([{ class: "UserLocal", id: 20, fields: {} }]));
    await runAs(admin, () =>
      build(fake).create({ type: "local", login: "bob", password: "long-enough", contact: { id: 4 }, profileIds: [5] }),
    );
    const create = fake.calls.find((c) => c.verb === "core/create")!;
    assert.equal(create.params["class"], "UserLocal");
    assert.equal(create.as, "admin");
    const fields = create.params["fields"] as Record<string, unknown>;
    assert.deepEqual(fields["profile_list"], [{ profileid: 5 }, { profileid: 9 }]);
    assert.equal(fields["password"], "long-enough");
  });

  it("never gives the REST profile to an end-user account", async () => {
    const fake = new FakeItopClient()
      .on("core/get", [PROFILES, USER(21), getResponse([]), getResponse([])])
      .on("core/create", getResponse([{ class: "UserLocal", id: 21, fields: {} }]));
    await runAs(admin, () =>
      build(fake).create({ type: "local", login: "carol", password: "long-enough", contact: { id: 4 }, profileIds: [2] }),
    );
    const fields = fake.calls.find((c) => c.verb === "core/create")!.params["fields"] as Record<string, unknown>;
    assert.deepEqual(fields["profile_list"], [{ profileid: 2 }]);
  });

  it("refuses a local account without a real password", async () => {
    await assert.rejects(
      () => build(new FakeItopClient()).create({ type: "local", login: "bob", password: "short", contact: { id: 4 }, profileIds: [5] }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });
});

describe("UsersService.update", () => {
  it("will not let an administrator disable their own account", async () => {
    const fake = new FakeItopClient().on("core/get", [USER(1), getResponse([]), getResponse([])]);
    await assert.rejects(
      () => runAs(admin, () => build(fake).update(1, { status: "disabled" })),
      (error: unknown) => error instanceof AppError && /your own account/.test(error.message),
    );
  });

  it("signs the user out everywhere when their access changes", async () => {
    const fake = new FakeItopClient()
      .on("core/get", [USER(20), getResponse([]), getResponse([]), USER(20), getResponse([]), getResponse([])])
      .on("core/update", getResponse([{ class: "UserLocal", id: 20, fields: {} }]));
    const sessions = new MemorySessionStore(3_600_000, 3_600_000);
    const sid = await sessions.create({ ...admin, userId: 20, login: "bob", isAdmin: false });
    const service = new UsersService(
      fake.asClient(),
      new ObjectsService(fake.asClient(), sampleSchema(), "test"),
      new AuthService(fake.asClient()),
      sessions,
    );
    await runAs(admin, () => service.update(20, { status: "disabled" }));
    assert.equal(await sessions.get(sid), undefined);
  });

  it("signs the user out when their linked person changes", async () => {
    const fake = new FakeItopClient()
      .on("core/get", [USER(20), getResponse([]), getResponse([]), USER(20), getResponse([]), getResponse([])])
      .on("core/update", getResponse([{ class: "UserLocal", id: 20, fields: {} }]));
    const sessions = new MemorySessionStore(3_600_000, 3_600_000);
    const sid = await sessions.create({ ...admin, userId: 20, login: "bob", isAdmin: false });
    const service = new UsersService(
      fake.asClient(),
      new ObjectsService(fake.asClient(), sampleSchema(), "test"),
      new AuthService(fake.asClient()),
      sessions,
    );
    // The inbox and the portal are scoped by the contact held in the session.
    await runAs(admin, () => service.update(20, { contactId: 77 }));
    assert.equal(await sessions.get(sid), undefined);
  });
});
