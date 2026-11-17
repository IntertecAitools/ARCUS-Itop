/**
 * The licence module (Build Guide, section 6): a platform capability, not a
 * business module. Other code imports it only through this file.
 *
 * `sdk/` is the self-contained licence format and verifier; `issuer/` is
 * Intertec's issuing side (the CLI); the rest is the product side.
 */
import type { FastifyInstance } from "fastify";
import type { Pool } from "mysql2/promise";
import type { LicensingConfig } from "../../config/env.js";
import { Sealer } from "../auth/seal.js";
import { readDevPublicKey } from "./issuer/signers.js";
import { registerFeatureGate, registerLicenceGuard } from "./licence.guard.js";
import { registerLicenceRoutes } from "./licence.routes.js";
import { LicenceService } from "./licence.service.js";
import { MemoryLicenceStore, MySqlLicenceStore, type LicenceStore } from "./licence.store.js";
import { registerLimitGuard } from "./usage.guard.js";
import { UsageService, type UsageCounters } from "./usage.service.js";

export { LicenceService, TRIAL_DAYS, type ScopeStatus } from "./licence.service.js";
export { MemoryLicenceStore, INSTALLATION_SCOPE, type LicenceStore } from "./licence.store.js";
export { isWriteExempt } from "./licence.guard.js";
export { UsageService, LicenceLimitError, hardCap, ACTIVE_MS, type UsageCounters } from "./usage.service.js";
export { isAgent, limitError } from "./usage.guard.js";
export { AGENT_PROFILES } from "./editions.js";
export { featureOfClass, featureOfRoute, type Feature } from "./editions.js";
export type * from "./licence.types.js";

export interface BuildLicensingOptions {
  pool?: Pool;
  /** SESSION_SECRET: seals the installation's private key in the database. */
  secret?: string;
  /** Injected in tests. */
  store?: LicenceStore;
  now?: () => Date;
  logger?: { info?(o: unknown, m?: string): void; warn?(o: unknown, m?: string): void; error?(o: unknown, m?: string): void };
}

/** The licence service for LICENSING=warn|enforce; undefined when off (the module is not loaded). */
export function buildLicensing(config: LicensingConfig | undefined, tenancy: boolean, options: BuildLicensingOptions = {}): LicenceService | undefined {
  if (!config) return undefined;
  const store = options.store ?? (options.pool ? new MySqlLicenceStore(options.pool, new Sealer(options.secret, "licence")) : new MemoryLicenceStore());
  const devPublicKeyPem = config.keys.allowDevKey ? readDevPublicKey(config.keys.devKeyDir) : undefined;
  return new LicenceService(
    store,
    {
      mode: config.mode,
      keys: { allowDevKey: config.keys.allowDevKey, ...(devPublicKeyPem ? { devPublicKeyPem } : {}) },
      tenancy,
      installationKind: config.installationKind,
    },
    options.now,
    options.logger,
  );
}

/** The read-only guard, the licence API, and the minute refresh. Called after the sign-in guard. */
/** Limits and metering over the licence module's tables. */
export function buildUsage(licensing: LicenceService, counters: UsageCounters, now?: () => Date): UsageService {
  return new UsageService(licensing, licensing.usageStore, counters, now);
}

export function registerLicensing(
  app: FastifyInstance,
  licensing: LicenceService,
  options: { platformLogins: string[]; lineage: (cls: string) => string[]; usage?: UsageService },
): void {
  // Remembers which module's feature each route belongs to (door 1).
  app.addHook("onRoute", (route) => licensing.noteRoute(route.url));
  registerFeatureGate(app, licensing, options.lineage);
  registerLicenceGuard(app, licensing);
  if (options.usage) registerLimitGuard(app, licensing, options.usage, options.lineage);
  registerLicenceRoutes(app, licensing, options);
  // The daily figures: stored every hour (the day's latest), so a restart loses at most an hour of peaks.
  let snapshots: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    await licensing.init();
    licensing.start();
    if (options.usage) {
      const usage = options.usage;
      snapshots = setInterval(() => void usage.snapshot().catch((err: unknown) => app.log.error({ err }, "usage snapshot failed")), 3_600_000);
      snapshots.unref?.();
    }
  });
  app.addHook("onClose", async () => {
    licensing.stop();
    if (snapshots) clearInterval(snapshots);
    await options.usage?.snapshot().catch(() => undefined);
  });
}

/**
 * Single sign-on and the edition (feature `sso`), once the user is known:
 * requesters are never refused (the portal is outside licensing); staff are
 * refused only when they can sign in with a password instead, so licensing
 * never locks anyone out. Otherwise, and with LICENSING=warn, the sign-in
 * goes through and is recorded. Returns a refusal message, or undefined.
 */
export async function ssoRefusal(
  licensing: LicenceService | undefined,
  caller: { kind: "staff" | "portal"; login: string },
  tenantId: string | undefined,
  staffMayUsePassword: boolean,
): Promise<string | undefined> {
  if (!licensing || caller.kind !== "staff") return undefined;
  const scope = licensing.scopeFor(tenantId);
  if (scope === null) return undefined;
  const status = await licensing.statusOf(scope);
  if (status.features.includes("sso")) return undefined;
  const refusal = licensing.featureRefusal(status, "sso");
  if (licensing.mode === "enforce" && staffMayUsePassword) {
    await licensing.recordOnce(scope, "refused", `sso:${caller.login}`, `Refused single sign-on for ${caller.login}: sso is not in the edition.`, caller.login);
    return `Single sign-on is not included in your edition; sign in with your password. ${refusal.message}`;
  }
  await licensing.recordOnce(scope, "would_refuse", `sso:${caller.login}`, `Single sign-on for ${caller.login} although sso is not in the edition${licensing.mode === "enforce" ? " (allowed: password sign-in is off for staff)" : ""}.`, caller.login);
  return undefined;
}
