/**
 * Issuing Arcus licences (Build Guide, section 5). Intertec only.
 *
 *   npm run licence -- dev-key
 *   npm run licence -- issue --customer "Example Co" --order SO-45678 \
 *       --type subscription --term 3 --edition PRO --deployment saas \
 *       --binding tenant:acme --agents 60 [--concurrent 0] [--ci-packs 0] [--ai-packs 0] \
 *       [--storage-packs 0] [--addon byok] [--instances 1,1,1] [--valid-from 2026-12-01] \
 *       [--reason "new order"] [--out acme-2026.lic]
 *   npm run licence -- reissue ARC-2026-000123 --reason "upgrade" [--edition ENT] [--agents 80] [--binding …] [--out …]
 *   npm run licence -- revoke  ARC-2026-000123 --reason "contract ended"
 *   npm run licence -- list   [--customer "Example Co"]
 *   npm run licence -- verify acme-2026.lic [--tenant acme | --installation <uuid>]
 *   npm run licence -- verify-report usage.json --key installation-public.pem
 *
 * Signing: LICENCE_SIGNER=dev (default; the local development key, kid
 * "dev", refused by production builds) or LICENCE_SIGNER=kms (AWS KMS, with
 * the licence-issuer role; LICENCE_KMS_KEY_ID, LICENCE_KMS_KID). Every
 * command writes to the licence register: the BFF database with
 * SESSION_STORE=mysql, else LICENCE_REGISTER_FILE.
 *
 * In production it is compiled with the BFF (dist/cli/licence.js).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { createPool } from "mysql2/promise";
import { loadLicenceIssuerConfig } from "../config/env.js";
import {
  ADDON_FLAGS,
  DEPLOYMENTS,
  EDITIONS,
  type AddonFlag,
  type Deployment,
  type Edition,
} from "../platform/licensing/editions.js";
import { buildLicenceFields, IssueError, issueLicence, type IssueRequest } from "../platform/licensing/issuer/issue.js";
import { FileRegisterStore, MySqlRegisterStore, type RegisterStore } from "../platform/licensing/issuer/register.store.js";
import { devSigner, ensureDevKey, kmsSigner, readDevPublicKey } from "../platform/licensing/issuer/signers.js";
import { verifyArcusLicence } from "../platform/licensing/licence.verify.js";
import { checkBinding, LICENCE_TYPES, termStatus, verifyDocument, type LicenceType, type Signer } from "../platform/licensing/sdk/index.js";

const config = loadLicenceIssuerConfig();
const [command, ...rest] = process.argv.slice(2);

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}

function parseArgs(args: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const value = args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") ? args[++i]! : "true";
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else positional.push(a);
  }
  return { positional, flags };
}

const args = parseArgs(rest);
const flag = (name: string) => args.flags.get(name)?.at(-1);
const flagAll = (name: string) => args.flags.get(name) ?? [];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function int(name: string, fallback?: number): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} must be a whole number.`);
  return n;
}

function oneOfFlag<T extends string>(name: string, allowed: readonly T[], fallback?: T): T | undefined {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const v = (name === "edition" ? raw.toUpperCase() : raw.toLowerCase()) as T;
  if (!allowed.includes(v)) fail(`--${name} must be one of ${allowed.join(", ")}.`);
  return v;
}

function instancesFlag(): IssueRequest["instances"] | undefined {
  const raw = flag("instances");
  if (!raw) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) fail("--instances is production,nonprod,standby, e.g. 1,1,1.");
  return { production: parts[0]!, nonprod: parts[1]!, standby: parts[2]! };
}

function addonsFlag(): AddonFlag[] | undefined {
  const raw = flagAll("addon").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  if (!raw.length) return undefined;
  for (const a of raw) if (!(ADDON_FLAGS as readonly string[]).includes(a)) fail(`--addon must be one of ${ADDON_FLAGS.join(", ")}.`);
  return raw as AddonFlag[];
}

const date = (name: string) => {
  const v = flag(name);
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`--${name} is a date, YYYY-MM-DD.`);
  return v;
};

function signer(): Signer {
  if (config.signer.kind === "dev") return devSigner(config.keys.devKeyDir);
  const { keyId, kid, alg, region } = config.signer;
  return kmsSigner({ keyId, kid, alg, ...(region ? { region } : {}) });
}

let closeRegister: () => Promise<void> = async () => {};
function register(): RegisterStore {
  if (config.register.kind === "file") return new FileRegisterStore(config.register.path);
  const s = config.register.store;
  const pool = createPool({ host: s.host, port: s.port, user: s.user, password: s.password, database: s.database, connectionLimit: 2 });
  closeRegister = () => pool.end();
  return new MySqlRegisterStore(pool);
}

const issuedBy = () => flag("by") ?? userInfo().username;

function summary(l: ReturnType<typeof buildLicenceFields>, kid?: string): string {
  const e = l.entitlements;
  return [
    `${l.licence_id}  ${l.customer_name}  (${l.order_ref || "no order"})${kid ? `  kid ${kid}` : ""}`,
    `  ${l.licence_type}${l.term_years ? ` ${l.term_years}y` : ""}  ${l.valid_from} → ${l.expires_at ?? "perpetual"}` +
      `${l.maintenance_until ? `  maintenance to ${l.maintenance_until}` : ""}  grace ${l.grace_days}d  ${l.binding}`,
    `  ${e.edition} ${e.deployment}: ${e.named_seats} agents, ${e.concurrent_seats} concurrent, ${e.ci_limit} CIs, ` +
      `${e.ai_actions_per_month} AI/month, storage ${e.storage_gb ?? "not limited"}${e.storage_gb !== null ? " GB" : ""}` +
      `${e.features.length ? `, add-ons ${e.features.join(", ")}` : ""}`,
  ].join("\n");
}

async function issue(store: RegisterStore, req: IssueRequest, reason: string, replaces: string | null): Promise<void> {
  const now = new Date();
  const id = await store.nextId(now.getUTCFullYear());
  const { text, licence } = await issueLicence(req, id, signer(), now);
  const out = flag("out") ?? `${id}.lic`;
  writeFileSync(out, text);
  await store.add({
    licenceId: id,
    customer: licence.customer_name,
    orderRef: licence.order_ref,
    binding: licence.binding,
    edition: licence.entitlements.edition,
    licenceType: licence.licence_type,
    validFrom: licence.valid_from,
    expiresAt: licence.expires_at,
    kid: licence.kid,
    text,
    request: req,
    issuedBy: issuedBy(),
    issuedAt: licence.issued_at,
    reason,
    replaces,
    replacedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  });
  if (replaces) await store.markReplaced(replaces, id);
  console.log(`${summary(licence, licence.kid)}\nWritten to ${out}${replaces ? `; replaces ${replaces}` : ""}.`);
}

function requestFromFlags(): IssueRequest {
  const type = oneOfFlag<LicenceType>("type", LICENCE_TYPES) ?? fail("--type is required (subscription, perpetual, evaluation, nonprod).");
  const edition = oneOfFlag<Edition>("edition", EDITIONS) ?? fail("--edition is required (ESS, PRO, ENT).");
  const deployment = oneOfFlag<Deployment>("deployment", DEPLOYMENTS) ?? fail("--deployment is required (saas, deployed).");
  const binding = flag("binding") ?? fail("--binding is required (tenant:<id> or install:<uuid>).");
  const term = int("term");
  const validFrom = date("valid-from");
  const grace = int("grace-days");
  const instances = instancesFlag();
  const addons = addonsFlag();
  return {
    customer: flag("customer") ?? fail("--customer is required."),
    orderRef: flag("order") ?? "",
    type,
    ...(term !== undefined ? { termYears: term } : {}),
    order: {
      edition,
      deployment,
      agents: int("agents") ?? fail("--agents is required."),
      concurrentSeats: int("concurrent", 0)!,
      ciPacks: int("ci-packs", 0)!,
      aiPacks: int("ai-packs", 0)!,
      storagePacks: int("storage-packs", 0)!,
      nodes: int("nodes", 0)!,
      ...(addons ? { addons } : {}),
    },
    binding,
    ...(validFrom ? { validFrom } : {}),
    ...(grace !== undefined ? { graceDays: grace } : {}),
    ...(instances ? { instances } : {}),
  };
}

/** A re-issue keeps the old request and changes only what is given. */
function reissueRequest(old: IssueRequest, oldExpiresAt: string | null): IssueRequest {
  const req: IssueRequest = structuredClone(old);
  const edition = oneOfFlag<Edition>("edition", EDITIONS);
  const type = oneOfFlag<LicenceType>("type", LICENCE_TYPES);
  if (edition) req.order.edition = edition;
  if (type) req.type = type;
  for (const [f, k] of [
    ["agents", "agents"],
    ["concurrent", "concurrentSeats"],
    ["ci-packs", "ciPacks"],
    ["ai-packs", "aiPacks"],
    ["storage-packs", "storagePacks"],
    ["nodes", "nodes"],
  ] as const) {
    const v = int(f);
    if (v !== undefined) req.order[k] = v;
  }
  const addons = addonsFlag();
  if (addons) req.order.addons = addons;
  const binding = flag("binding");
  if (binding) req.binding = binding;
  const instances = instancesFlag();
  if (instances) req.instances = instances;
  const term = int("term");
  const validFrom = date("valid-from");
  const expires = date("expires");
  if (term !== undefined) req.termYears = term;
  if (validFrom) req.validFrom = validFrom;
  // Same end date unless the term changes (an upgrade mid-term keeps it).
  delete req.expiresAt;
  if (expires) req.expiresAt = expires;
  else if (term === undefined && !validFrom && oldExpiresAt) req.expiresAt = oldExpiresAt;
  return req;
}

function verify(path: string): void {
  const text = readFileSync(path, "utf8");
  const result = verifyArcusLicence(text, {
    allowDevKey: config.keys.allowDevKey,
    ...(readDevPublicKey(config.keys.devKeyDir) ? { devPublicKeyPem: readDevPublicKey(config.keys.devKeyDir)! } : {}),
  });
  if (!result.ok) fail(`INVALID (${result.reason}): ${result.message}`);
  const l = result.licence;
  const term = termStatus(l, new Date());
  console.log(`VALID\n${summary(l, l.kid)}`);
  console.log(`  today: ${term.phase}${term.daysLeft !== null ? `, ${term.daysLeft} days to expiry` : ""}${term.graceDaysLeft !== null ? `, ${term.graceDaysLeft} days of grace left` : ""}${term.maintenanceLapsed ? ", maintenance lapsed" : ""}`);
  const tenant = flag("tenant");
  const installation = flag("installation");
  if (tenant || installation) {
    console.log(`  binding: ${checkBinding(l.binding, { ...(tenant ? { tenant } : {}), ...(installation ? { installation } : {}) })}`);
  }
}

async function main(): Promise<void> {
  switch (command) {
    case "dev-key": {
      const { created } = ensureDevKey(config.keys.devKeyDir);
      console.log(`${created ? "Made" : "Already have"} the development key in ${config.keys.devKeyDir} (kid "dev"; never commit it).`);
      return;
    }
    case "issue": {
      const store = register();
      await issue(store, requestFromFlags(), flag("reason") ?? "new order", null);
      return;
    }
    case "reissue": {
      const id = args.positional[0] ?? fail("Which licence? reissue ARC-2026-000123 --reason …");
      const reason = flag("reason") ?? fail("--reason is required (e.g. upgrade, moved, correction).");
      const store = register();
      const old = (await store.get(id)) ?? fail(`No licence ${id} in the register.`);
      if (old.revokedAt) fail(`Licence ${id} was revoked on ${old.revokedAt}; issue a new one instead.`);
      await issue(store, reissueRequest(old.request, old.expiresAt), reason, id);
      return;
    }
    case "revoke": {
      const id = args.positional[0] ?? fail("Which licence? revoke ARC-2026-000123 --reason …");
      const reason = flag("reason") ?? fail("--reason is required.");
      await register().revoke(id, issuedBy(), reason, new Date().toISOString());
      console.log(`Revoked ${id}: ${reason}.`);
      return;
    }
    case "list": {
      const customer = flag("customer");
      const rows = await register().list(customer ? { customer } : undefined);
      if (!rows.length) console.log("No licences in the register.");
      for (const r of rows) {
        const status = r.revokedAt ? `revoked ${r.revokedAt.slice(0, 10)}` : r.replacedBy ? `replaced by ${r.replacedBy}` : "current";
        console.log(`${r.licenceId}  ${r.customer}  ${r.edition} ${r.licenceType}  ${r.validFrom} → ${r.expiresAt ?? "perpetual"}  ${r.binding}  ${status}  (${r.reason}; ${r.issuedBy})`);
      }
      return;
    }
    case "verify-report": {
      // A usage report checked with the installation's registered public key (LT-15).
      const file = args.positional[0] ?? fail("Which file? verify-report usage.json --key installation-public.pem");
      const keyFile = flag("key") ?? fail("--key is the installation's public key (PEM), from its licence page or activation request.");
      const check = verifyDocument<{ licence_id: string | null; from: string; to: string; installation_id: string; peaks: Record<string, number> }>(
        readFileSync(file, "utf8"),
        { kind: "usage_report", publicKeyPem: readFileSync(keyFile, "utf8") },
      );
      if (!check.ok) fail(`INVALID: ${check.message}`);
      const p = check.document.payload;
      console.log(`VALID usage report: licence ${p.licence_id ?? "none"}, installation ${p.installation_id}, ${p.from} → ${p.to}`);
      console.log(`  peaks: ${Object.entries(p.peaks).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      return;
    }
    case "verify": {
      verify(args.positional[0] ?? fail("Which file? verify acme-2026.lic"));
      return;
    }
    default:
      fail("Usage: npm run licence -- dev-key | issue … | reissue <id> … | revoke <id> … | list | verify <file> | verify-report <file> --key <pem>  (see src/cli/licence.ts)");
  }
}

main()
  .catch((err: unknown) => fail(err instanceof IssueError ? err.message : `Failed: ${err instanceof Error ? err.message : String(err)}`))
  .finally(() => closeRegister());
