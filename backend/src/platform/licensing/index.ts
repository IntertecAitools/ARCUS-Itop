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
import { devSigner, kmsSigner, readDevPublicKey } from "./issuer/signers.js";
import { MemoryRegisterStore, MySqlRegisterStore, type RegisterStore } from "./issuer/register.store.js";
import { registerDeskRoutes } from "./desk.routes.js";
import { fetchRevocationList, registerActivationRoutes, type ActivationOptions } from "./activation.routes.js";
import type { Signer } from "./sdk/index.js";
import type { TenantStore } from "../tenancy/tenant.store.js";
import { registerFeatureGate, registerLicenceGuard } from "./licence.guard.js";
import { registerLicenceRoutes } from "./licence.routes.js";
import { LicenceService } from "./licence.service.js";
import { MemoryLicenceStore, MySqlLicenceStore, type LicenceStore } from "./licence.store.js";
import { registerLimitGuard } from "./usage.guard.js";
import { UsageService, type UsageCounters } from "./usage.service.js";

export { LicenceService, TRIAL_DAYS, type ScopeStatus } from "./licence.service.js";
export { MemoryLicenceStore, INSTALLATION_SCOPE, type LicenceStore } from "./licence.store.js";
export { isWriteExempt } from "./licence.guard.js";
export { activationRequest, readActivationRequest, readRevocationList, ACTIVATION_KIND, REVOCATION_KIND, type ActivationRequest, type RevocationList } from "./activation.js";
export { fetchRevocationList, type ActivationOptions } from "./activation.routes.js";
export { REACTIVATION_DAYS } from "./licence.service.js";
export { MemoryRegisterStore, type RegisterStore } from "./issuer/register.store.js";
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
  register?: RegisterStore;
  signer?: Signer;
  now?: () => Date;
  logger?: { info?(o: unknown, m?: string): void; warn?(o: unknown, m?: string): void; error?(o: unknown, m?: string): void };
}

/** The licence service for LICENSING=warn|enforce; undefined when off (the module is not loaded). */
/** The licence desk's parts on this server: the register and, when configured, a signer. */
export interface LicenceDeskParts {
  register: RegisterStore;
  signer?: Signer;
}

/**
 * The licence service for LICENSING=warn|enforce, with the licence desk
 * (register and signer); undefined when off (the module is not loaded).
 */
export function buildLicensing(
  config: LicensingConfig | undefined,
  tenancy: boolean,
  options: BuildLicensingOptions = {},
): { licensing: LicenceService; desk: LicenceDeskParts } | undefined {
  if (!config) return undefined;
  const store = options.store ?? (options.pool ? new MySqlLicenceStore(options.pool, new Sealer(options.secret, "licence")) : new MemoryLicenceStore());
  const register = options.register ?? (options.pool ? new MySqlRegisterStore(options.pool) : new MemoryRegisterStore());
  const devPublicKeyPem = config.keys.allowDevKey ? readDevPublicKey(config.keys.devKeyDir) : undefined;
  const signer = options.signer ?? (config.signer ? signerFor(config.signer, config.keys.devKeyDir) : undefined);
  const licensing = new LicenceService(
    store,
    {
      mode: config.mode,
      keys: { allowDevKey: config.keys.allowDevKey, ...(devPublicKeyPem ? { devPublicKeyPem } : {}) },
      tenancy,
      installationKind: config.installationKind,
      ...(config.clusterId ? { clusterId: config.clusterId } : {}),
      ...(config.releaseDate ? { releaseDate: config.releaseDate } : {}),
      // SaaS: the platform's register says which licences are revoked.
      ...(tenancy
        ? { revokedIds: async () => new Set((await register.list()).filter((e) => e.revokedAt).map((e) => e.licenceId)) }
        : {}),
    },
    options.now,
    options.logger,
  );
  return { licensing, desk: { register, ...(signer ? { signer } : {}) } };
}

function signerFor(config: NonNullable<LicensingConfig["signer"]>, devKeyDir: string): Signer {
  if (config.kind === "dev") return devSigner(devKeyDir);
  const { keyId, kid, alg, region } = config;
  return kmsSigner({ keyId, kid, alg, ...(region ? { region } : {}) });
}

/** The read-only guard, the licence API, and the minute refresh. Called after the sign-in guard. */
/** Limits and metering over the licence module's tables. */
export function buildUsage(licensing: LicenceService, counters: UsageCounters, now?: () => Date): UsageService {
  return new UsageService(licensing, licensing.usageStore, counters, now);
}

export function registerLicensing(
  app: FastifyInstance,
  licensing: LicenceService,
  options: {
    platformLogins: string[];
    lineage: (cls: string) => string[];
    usage?: UsageService;
    /** The licence desk (operator Licences page); with TENANCY's tenant store. */
    desk?: LicenceDeskParts & { tenants: TenantStore };
    /** Deployed activation and the revocation list. */
    activation?: ActivationOptions;
  },
): void {
  // Remembers which module's feature each route belongs to (door 1).
  app.addHook("onRoute", (route) => licensing.noteRoute(route.url));
  registerFeatureGate(app, licensing, options.lineage);
  registerLicenceGuard(app, licensing);
  if (options.usage) registerLimitGuard(app, licensing, options.usage, options.lineage);
  registerLicenceRoutes(app, licensing, {
    ...options,
    activation: { online: !!options.activation?.activationUrl, ...(options.activation?.clusterId ? { clusterId: options.activation.clusterId } : {}) },
  });
  if (options.activation) registerActivationRoutes(app, licensing, options.activation);
  if (options.desk) registerDeskRoutes(app, licensing, { ...options.desk, platformLogins: options.platformLogins });
  // The daily figures: stored every hour (the day's latest), so a restart loses at most an hour of peaks.
  let snapshots: NodeJS.Timeout | undefined;
  let revocations: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    await licensing.init();
    licensing.start();
    // Deployed, online: Intertec's signed revocation list, at start and once a day.
    const revocationUrl = options.activation?.revocationUrl;
    if (revocationUrl && !licensing.settings.tenancy) {
      const fetchList = () =>
        void fetchRevocationList(licensing, revocationUrl, options.activation?.fetch).then((r) => app.log.info({ result: r }, "licence revocation list"));
      fetchList();
      revocations = setInterval(fetchList, 86_400_000);
      revocations.unref?.();
    }
    if (options.usage) {
      const usage = options.usage;
      snapshots = setInterval(() => void usage.snapshot().catch((err: unknown) => app.log.error({ err }, "usage snapshot failed")), 3_600_000);
      snapshots.unref?.();
    }
  });
  app.addHook("onClose", async () => {
    licensing.stop();
    if (snapshots) clearInterval(snapshots);
    if (revocations) clearInterval(revocations);
    await options.usage?.snapshot().catch(() => undefined);
  });
}
