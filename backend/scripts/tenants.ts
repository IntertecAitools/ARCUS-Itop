/**
 * Tenants: who the platform's customers are and which iTop organisations are
 * theirs. Kept in the BFF database (SESSION_STORE=mysql), or TENANTS_FILE.
 *
 *   npm run tenants -- list
 *   npm run tenants -- set acme --name "Acme Ltd" --domain acme.example.com --org 12 --org 13
 *   npm run tenants -- disable acme | enable acme | remove acme
 *   npm run tenants -- seed-test       two test tenants in a local iTop (below)
 *
 * `set` replaces the tenant's domains and organisations with the ones given.
 * An organisation or a domain belongs to one tenant at most.
 *
 * seed-test creates, in iTop, two organisations (zz-mt-acme, zz-mt-globex),
 * and in each a person, an agent account (Service Desk Agent, limited to its
 * organisation), an administrator account, a user request and a server;
 * then the tenants `mt-acme` (acme.localhost) and `mt-globex`
 * (globex.localhost). Safe to run again: it reuses what exists. The
 * accounts' password is MT_TEST_PASSWORD, else the one below: local test
 * data only, never for a real iTop.
 */
import { loadConfig } from "../src/config/env.js";
import { normalizeObjects } from "../src/itop/normalize.js";
import { quoteString } from "../src/itop/oql.js";
import { buildServices } from "../src/services.js";
import type { Tenant } from "../src/platform/tenancy/tenant.store.js";

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
      if (!id) throw new Error("Usage: set <id> --name <name> [--domain <host>]... [--org <id>]...");
      const tenant: Tenant = {
        id,
        name: flags(rest, "name")[0] ?? existing?.name ?? id,
        status: existing?.status ?? "active",
        domains: flags(rest, "domain"),
        orgIds: flags(rest, "org").map(Number),
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
    default:
      console.log("Commands: list | set <id> --name N --domain D --org N | enable <id> | disable <id> | remove <id> | seed-test");
  }
}

main()
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => services.sessions.close());
