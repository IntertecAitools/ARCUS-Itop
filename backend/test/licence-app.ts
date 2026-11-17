import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

import { buildApp } from "../src/app.js";
import type { Config } from "../src/config/env.js";
import type { Caller } from "../src/core/request-context.js";
import { MemorySessionStore } from "../src/platform/auth/session.store.js";
import { buildLicenceFields, type IssueRequest } from "../src/platform/licensing/issuer/issue.js";
import { devSigner } from "../src/platform/licensing/issuer/signers.js";
import { MemoryLicenceStore, type LicenceStatus } from "../src/platform/licensing/index.js";
import { signLicence } from "../src/platform/licensing/sdk/index.js";
import { MemoryTenantStore } from "../src/platform/tenancy/tenant.store.js";
import type { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

/**
 * A BFF with the licence module on, a fake clock, signed-in users of every
 * kind and a one-line licence issuer: the licence tests' shared setup.
 */
/** A development key for this run only: the licence module trusts it as kid "dev". */
const DEV_DIR = mkdtempSync(join(tmpdir(), "arcus-licence-test-"));
const signer = devSigner(DEV_DIR);

function person(login: string, kind: "staff" | "portal", profiles: string[]): Caller {
  return {
    userId: login.length,
    login,
    contactId: 1,
    name: login,
    email: "",
    kind,
    profiles,
    isAdmin: profiles.includes("Administrator"),
    allowedOrgIds: [],
    orgId: 10,
    credentials: { user: login, password: "pw" },
  };
}

export interface SetupOptions {
  mode?: "warn" | "enforce";
  tenancy?: boolean;
  kind?: "production" | "nonprod" | "standby";
  start?: string;
  /** Agent and CI counts the limits see (default 0). */
  counts?: { agents: number; cis: number };
  /** The real schema instead of the small sample (CI classes, lineages). */
  schema?: CmdbSchema;
  /** More licensing settings: cluster id, release date, activation and revocation addresses. */
  settings?: Partial<Pick<NonNullable<Config["licensing"]>, "clusterId" | "releaseDate" | "activationUrl" | "revocationUrl">>;
  /** Stands in for Intertec's activation and revocation addresses. */
  fetch?: typeof fetch;
  /** Reuse these tables: a restart of the BFF over the same database. */
  store?: MemoryLicenceStore;
  /** The server cannot sign (no LICENCE_SIGNER): the desk lists and revokes only. */
  noSigner?: boolean;
  /** Extra fake upstream answers, after the defaults. */
  itop?: (fake: FakeItopClient) => void;
}

export async function licenceApp(options: SetupOptions = {}) {
  const clock = { now: new Date(options.start ?? "2026-12-01T09:00:00Z") };
  const fake = new FakeItopClient();
  fake.on("core/get", () => getResponse([{ class: "Organization", id: 1, fields: { name: "HQ", status: "active", parent_id: 0 } }]));
  fake.on("core/create", (p) => getResponse([{ class: String(p["class"]), id: 99, fields: { name: "new" } }]));
  options.itop?.(fake);
  const schema = options.schema ?? sampleSchema();
  const counts = options.counts ?? { agents: 0, cis: 0 };
  const sessions = new MemorySessionStore(3_600_000, 3_600_000);
  const store = options.store ?? new MemoryLicenceStore();
  const tenancy = options.tenancy === true;
  const config: Config = {
    ...testConfig({ auth: { required: true, sessionIdleMs: 3_600_000, sessionMaxMs: 3_600_000, cookieSecure: false, sessionStore: { kind: "memory" } } }),
    licensing: {
      mode: options.mode ?? "enforce",
      keys: { allowDevKey: true, devKeyDir: DEV_DIR },
      installationKind: options.kind ?? "production",
      ...(options.noSigner ? {} : { signer: { kind: "dev" as const } }),
      version: "0.1.0-test",
      ...options.settings,
    },
    ...(tenancy ? { tenancy: { enabled: true, platformLogins: ["operator"] } } : {}),
  };
  const { app, services } = buildApp(config, {
    client: fake.asClient(),
    schema,
    navigation: sampleNavigation(schema),
    dashboards: sampleDashboards(fake.asClient(), schema),
    sessions,
    licenceStore: store,
    licenceClock: () => clock.now,
    usageCounters: { agents: async () => counts.agents, cis: async () => counts.cis },
    ...(options.fetch ? { licenceFetch: options.fetch } : {}),
    ...(tenancy ? { tenants: new MemoryTenantStore([{ id: "acme", name: "Acme", status: "active", domains: ["acme.test"], orgIds: [10] }]) } : {}),
  });
  await app.ready();
  after(() => app.close());
  const licensing = services.licensing!;
  const cookie = async (c: Caller) => `intertec_sid=${await sessions.create(c)}`;
  const host = tenancy ? "acme.test" : "app.test";
  const users = {
    admin: await cookie(person("admin", "staff", ["Administrator", "Support Agent"])),
    agent: await cookie(person("agent", "staff", ["Support Agent"])),
    requester: await cookie(person("pat", "portal", ["Portal user"])),
    operator: await cookie(person("operator", "staff", ["Administrator"])),
  };
  /** A request as `who`, on the customer's site (or `at`, e.g. the platform's own address). */
  const send = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, who: string, payload?: unknown, at = host) =>
    app.inject({ method, url, headers: { host: at, cookie: who }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const status = async (who = users.agent) => (await send("GET", "/api/licence/status", who)).json() as LicenceStatus;
  /** Moves the clock and lets the minute refresh run. */
  const advanceTo = async (iso: string) => {
    clock.now = new Date(iso);
    await licensing.refresh();
  };
  const binding = tenancy ? "tenant:acme" : `install:${licensing.installation().id}`;
  const issue = async (req: Partial<Omit<IssueRequest, "order">> & { order?: Partial<IssueRequest["order"]> } = {}, id = "ARC-2026-000123") => {
    const { order, ...rest } = req;
    const full: IssueRequest = {
      customer: "Example Co",
      orderRef: "SO-1",
      type: "subscription",
      termYears: 1,
      validFrom: "2026-12-01",
      binding,
      ...rest,
      order: { edition: "PRO", deployment: tenancy ? "saas" : "deployed", agents: 10, ...order },
    };
    return (await signLicence(buildLicenceFields(full, id, clock.now), signer)).text;
  };
  /** Installs a key; on a deployed installation the EULA is accepted with it unless `acceptEula: false`. */
  const install = (text: string, who = tenancy ? users.operator : users.admin, confirmOlder?: boolean, acceptEula = !tenancy) =>
    send("PUT", "/api/licence", who, { text, ...(confirmOlder ? { confirmOlder } : {}), ...(acceptEula ? { acceptEula } : {}) });
  const write = (who = users.agent) => send("POST", "/api/objects/Organization", who, { fields: { name: "Branch" } });
  const exportCsv = (who = users.agent) => send("GET", "/api/objects/Organization/export?format=csv", who);
  return { app, services, licensing, usage: services.licenceUsage!, counts, store, clock, users, send, status, advanceTo, issue, install, write, exportCsv };
}


export const code = (r: { json(): unknown }) => (r.json() as { error?: { code?: string } }).error?.code;
