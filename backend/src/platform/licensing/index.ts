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
import { registerLicenceGuard } from "./licence.guard.js";
import { registerLicenceRoutes } from "./licence.routes.js";
import { LicenceService } from "./licence.service.js";
import { MemoryLicenceStore, MySqlLicenceStore, type LicenceStore } from "./licence.store.js";

export { LicenceService, TRIAL_DAYS, type ScopeStatus } from "./licence.service.js";
export { MemoryLicenceStore, INSTALLATION_SCOPE, type LicenceStore } from "./licence.store.js";
export { isWriteExempt } from "./licence.guard.js";
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
export function registerLicensing(app: FastifyInstance, licensing: LicenceService, options: { platformLogins: string[] }): void {
  registerLicenceGuard(app, licensing);
  registerLicenceRoutes(app, licensing, options);
  app.addHook("onReady", async () => {
    await licensing.init();
    licensing.start();
  });
  app.addHook("onClose", async () => licensing.stop());
}
