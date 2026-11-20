/**
 * Tenants: who the platform's customers are and which iTop organisations are
 * theirs. Kept in the BFF database (SESSION_STORE=mysql), or TENANTS_FILE.
 *
 *   npm run tenants -- list
 *   npm run tenants -- set acme --name "Acme Ltd" --domain acme.example.com --org 12 --org 13
 *   npm run tenants -- set intertec --name Intertec --all-orgs   every organisation in iTop
 *   npm run tenants -- unclaimed      enabled accounts no tenant claims (refused once TENANCY=on)
 *   npm run tenants -- disable acme | enable acme | remove acme
 *   npm run tenants -- seed-test       two test tenants in a local iTop (below)
 *
 * In production it is compiled with the BFF; run it in the bff container:
 *
 *   docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env \
 *     exec bff node dist/cli/tenants.js list
 *
 * `set` replaces the tenant's domains and organisations with the ones given.
 * An organisation or a domain belongs to one tenant at most. `--all-orgs`
 * takes every organisation iTop has: the way to turn a single-company
 * installation into one tenant before switching TENANCY on. It can run
 * while the BFF itself still has TENANCY off: give this command
 * TENANCY=on in its own environment.
 *
 * `unclaimed` lists the enabled accounts no tenant would claim (by their
 * person's organisation, else their allowed organisations), other than the
 * platform operators in PLATFORM_LOGINS: once TENANCY is on they are refused
 * at sign-in. Run it before switching, and fix each one (give the person an
 * organisation of the tenant).
 *
 * seed-test creates, in iTop, two organisations (zz-mt-acme, zz-mt-globex),
 * and in each a person, an agent account (Service Desk Agent, limited to its
 * organisation), an administrator account, a user request and a server;
 * then the tenants `mt-acme` (acme.localhost) and `mt-globex`
 * (globex.localhost). Safe to run again: it reuses what exists. The
 * accounts' password is MT_TEST_PASSWORD, else the one below: local test
 * data only, never for a real iTop.
 */
import { loadConfig } from "../config/env.js";
import { normalizeObjects } from "../itop/normalize.js";
import { quoteString } from "../itop/oql.js";
import { buildServices } from "../services.js";
import { tenantOfUser } from "../platform/tenancy/resolve.js";
import type { Tenant } from "../platform/tenancy/tenant.store.js";

const TEST_PASSWORD = process.env["MT_TEST_PASSWORD"] ?? "Tenancy-Test-2026!";
const TEST_TENANTS = [
  { id: "mt-acme", name: "MT Acme", org: "zz-mt-acme", domain: "acme.localhost", prefix: "mt.acme" },
  { id: "mt-globex", name: "MT Globex", org: "zz-mt-globex", domain: "globex.localhost", prefix: "mt.globex" },
] as const;

const config = loadConfig();
if (!config.tenancy?.enabled) {
  console.error("Set TENANCY=on (with SESSION_STORE=mysql or TENANTS_FILE) to manage tenants.");
  process.exit(1);
}
const services = buildServices(config);
const { tenantStore: store, client } = services;

function flags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === `--${name}` && args[i + 1]) out.push(args[++i]!);
  return out;
}

async function find(cls: string, oql: string): Promise<number | undefined> {
  const res = await client.call("core/get", { class: cls, key: oql, output_fields: "id", limit: 1 }, { asService: true });
  return normalizeObjects(res.objects)[0]?.id;
}

async function ensure(cls: string, oql: string, fields: Record<string, unknown>): Promise<number> {
  const existing = await find(cls, oql);
  if (existing) return existing;
  const res = await client.call("core/create", { class: cls, fields, output_fields: "id", comment: "Tenancy test data" }, { asService: true });
  const row = normalizeObjects(res.objects)[0];
  if (!row) throw new Error(`iTop created no ${cls}.`);
  return row.id;
}

async function profileId(name: string): Promise<number> {
  const id = await find("URP_Profiles", `SELECT URP_Profiles WHERE name = ${quoteString(name)}`);
  if (!id) throw new Error(`iTop has no profile "${name}".`);
  return id;
}

async function seedTest(): Promise<void> {
  const agentProfiles = [await profileId("Service Desk Agent"), await profileId("REST Services User")];
  const adminProfiles = [await profileId("Administrator"), await profileId("REST Services User")];
  const summary: Record<string, unknown> = {};
  for (const t of TEST_TENANTS) {
    const org = await ensure("Organization", `SELECT Organization WHERE name = ${quoteString(t.org)}`, { name: t.org });
    const person = await ensure("Person", `SELECT Person WHERE email = ${quoteString(`${t.prefix}@example.test`)}`, {
      name: `${t.name} Agent`,
      first_name: "Test",
      email: `${t.prefix}@example.test`,
      org_id: org,
    });
    for (const [suffix, profiles, allowed] of [
      ["agent", agentProfiles, [org]],
      ["admin", adminProfiles, [org]],
    ] as const) {
      const login = `${t.prefix}.${suffix}`;
      await ensure("UserLocal", `SELECT UserLocal WHERE login = ${quoteString(login)}`, {
        login,
        password: TEST_PASSWORD,
        contactid: person,
        status: "enabled",
        profile_list: profiles.map((profileid) => ({ profileid })),
        allowed_org_list: allowed.map((allowed_org_id) => ({ allowed_org_id })),
      });
    }
    const ticket = await ensure("UserRequest", `SELECT UserRequest WHERE title = ${quoteString(`${t.name} printer jam`)}`, {
      title: `${t.name} printer jam`,
      description: "Tenancy test ticket",
      org_id: org,
      caller_id: person,
    });
    const server = await ensure("Server", `SELECT Server WHERE name = ${quoteString(`${t.prefix}-srv`)}`, {
      name: `${t.prefix}-srv`,
      org_id: org,
    });
    await store.save({ id: t.id, name: t.name, status: "active", domains: [t.domain], orgIds: [org] });
    summary[t.id] = { org, person, ticket, server, logins: [`${t.prefix}.agent`, `${t.prefix}.admin`], domain: t.domain };
  }
  console.log(JSON.stringify(summary, null, 2));
}

/** Every organisation id iTop has, a page at a time. */
async function allOrgIds(): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; ; page += 1) {
    const res = await client.call("core/get", { class: "Organization", key: "SELECT Organization", output_fields: "id", limit: 500, page }, { asService: true });
    const rows = normalizeObjects(res.objects);
    ids.push(...rows.map((r) => Number(r.id)));
    if (rows.length < 500) return ids.sort((a, b) => a - b);
  }
}

/** Enabled accounts no tenant claims and that are not platform operators. */
async function unclaimed(): Promise<void> {
  const tenants = await store.list();
  const operators = new Set((config.tenancy?.platformLogins ?? []).map((l) => l.toLowerCase()));
  let checked = 0;
  const refused: string[] = [];
  for (let page = 1; ; page += 1) {
    const res = await client.call(
      "core/get",
      { class: "User", key: "SELECT User WHERE status = 'enabled'", output_fields: "login,org_id,org_name,allowed_org_list", limit: 500, page },
      { asService: true },
    );
    const rows = normalizeObjects(res.objects);
    for (const r of rows) {
      checked += 1;
      const f = r.fields as Record<string, unknown>;
      const login = String(f["login"] ?? "");
      if (operators.has(login.toLowerCase())) continue;
      const allowed = Array.isArray(f["allowed_org_list"]) ? (f["allowed_org_list"] as Record<string, unknown>[]).map((a) => Number(a["allowed_org_id"])) : [];
      const facts = { login, orgId: Number(f["org_id"] ?? 0), allowedOrgIds: allowed };
      if (!tenantOfUser(facts, tenants)) refused.push(`${login}	org: ${f["org_name"] || "-"} (${facts.orgId})	allowed: ${allowed.join(", ") || "-"}`);
    }
    if (rows.length < 500) break;
  }
  for (const line of refused) console.log(line);
  console.log(`${checked} enabled accounts checked; ${refused.length} no tenant claims${refused.length ? " (refused at sign-in once TENANCY=on)" : ""}.`);
  if (refused.length) process.exitCode = 2;
}

function print(t: Tenant): void {
  console.log(`${t.id}\t${t.status}\t${t.name}\tdomains: ${t.domains.join(", ") || "-"}\torgs: ${t.orgIds.join(", ") || "-"}`);
}

async function main(): Promise<void> {
  const [command, id, ...rest] = process.argv.slice(2);
  const existing = id ? (await store.list()).find((t) => t.id === id) : undefined;
  switch (command) {
    case "list":
      for (const t of await store.list()) print(t);
      break;
    case "set": {
      if (!id) throw new Error("Usage: set <id> --name <name> [--domain <host>]... [--org <id>]... | --all-orgs");
      const tenant: Tenant = {
        id,
        name: flags(rest, "name")[0] ?? existing?.name ?? id,
        status: existing?.status ?? "active",
        domains: flags(rest, "domain"),
        orgIds: rest.includes("--all-orgs") ? await allOrgIds() : flags(rest, "org").map(Number),
      };
      await store.save(tenant);
      print(tenant);
      break;
    }
    case "enable":
    case "disable":
      if (!existing) throw new Error(`No tenant ${id ?? ""}.`);
      await store.save({ ...existing, status: command === "enable" ? "active" : "disabled" });
      break;
    case "remove":
      if (!id) throw new Error("Usage: remove <id>");
      await store.remove(id);
      break;
    case "seed-test":
      await seedTest();
      break;
    case "unclaimed":
      await unclaimed();
      break;
    default:
      console.log("Commands: list | set <id> --name N --domain D --org N | --all-orgs | unclaimed | enable <id> | disable <id> | remove <id> | seed-test");
  }
}

main()
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => services.sessions.close());
