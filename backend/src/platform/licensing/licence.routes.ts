import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import { parse } from "../../core/validate.js";
import { LicenceError, type LicenceService } from "./licence.service.js";
import type { LicenceStatus } from "./licence.types.js";
import { FEATURES, lowestEditionWith } from "./editions.js";

const KeyBody = z.object({
  /** The `.lic` text, pasted or read from the file. */
  text: z.string().min(20).max(20_000),
  /** Install a licence issued before the one installed now (a replay needs a person to confirm it). */
  confirmOlder: z.boolean().optional(),
});

/** The platform's own address with tenancy on: not a customer, nothing to license. */
const PLATFORM_STATUS = (mode: LicenceStatus["mode"]): LicenceStatus => ({
  mode,
  state: "valid",
  readOnly: false,
  edition: null,
  editionName: null,
  features: [],
  featureEditions: Object.fromEntries(FEATURES.map((f) => [f, lowestEditionWith(f)])) as LicenceStatus["featureEditions"],
  licenceType: null,
  expiresAt: null,
  daysLeft: null,
  graceDaysLeft: null,
  nonProduction: false,
  maintenanceLapsed: false,
  banners: [],
});

export function registerLicenceRoutes(app: FastifyInstance, licensing: LicenceService, options: { platformLogins: string[] }): void {
  const operators = new Set(options.platformLogins.map((l) => l.toLowerCase()));

  const scope = () => {
    const s = licensing.scopeFor(currentTenant()?.id);
    if (s === null) throw new AppError("bad_request", "Open the customer's own site to see or install its licence.");
    return s;
  };

  /** Who may install a key: the installation's administrators; in SaaS, platform operators only. */
  const assertMayInstall = () => {
    const caller = currentCaller();
    const ok = licensing.settings.tenancy ? !!caller && operators.has(caller.login.toLowerCase()) : !!caller?.isAdmin;
    if (!ok) {
      throw new AppError(
        "forbidden",
        licensing.settings.tenancy ? "Licences are installed by the platform operator." : "Only administrators can install a licence.",
      );
    }
    return caller!;
  };

  const assertAdmin = () => {
    const caller = currentCaller();
    if (!caller?.isAdmin) throw new AppError("forbidden", "Only administrators can do this.");
    return caller;
  };

  app.get("/api/licence/status", async (): Promise<LicenceStatus> => {
    const caller = currentCaller();
    const s = licensing.scopeFor(currentTenant()?.id);
    if (s === null) return PLATFORM_STATUS(licensing.mode);
    return licensing.toDto(await licensing.statusOf(s), { isAdmin: !!caller?.isAdmin, isStaff: caller?.kind === "staff" });
  });

  app.post("/api/licence/check", async (request) => {
    assertAdmin();
    const body = parse(KeyBody, request.body, "body");
    return licensing.check(scope(), body.text);
  });

  app.put("/api/licence", async (request) => {
    const caller = assertMayInstall();
    const body = parse(KeyBody, request.body, "body");
    try {
      return await licensing.install(scope(), body.text, caller.login, body.confirmOlder === true);
    } catch (err) {
      if (err instanceof LicenceError) throw new AppError("bad_request", err.message);
      throw err;
    }
  });
}
