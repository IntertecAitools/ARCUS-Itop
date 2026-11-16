import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import { parse } from "../../core/validate.js";
import { LicenceError, type LicenceService } from "./licence.service.js";
import type { UsageService } from "./usage.service.js";
import type { LicenceDetail, LicenceStatus } from "./licence.types.js";
import { EULA_TEXT, EULA_VERSION } from "./eula.js";
import { keyFingerprint } from "./sdk/index.js";
import { FEATURES, lowestEditionWith } from "./editions.js";

const KeyBody = z.object({
  /** The `.lic` text, pasted or read from the file. */
  text: z.string().min(20).max(20_000),
  /** Install a licence issued before the one installed now (a replay needs a person to confirm it). */
  confirmOlder: z.boolean().optional(),
  /** Deployed: the first key is installed with the EULA accepted (LIC-17). */
  acceptEula: z.boolean().optional(),
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ReportQuery = z.object({ from: z.string().regex(DAY), to: z.string().regex(DAY) }).refine((q) => q.from <= q.to, "from must not be after to");

const EVENT_LABELS: Record<string, string> = {
  key_uploaded: "Key installed",
  state_changed: "State changed",
  clock_warning: "Clock warning",
  tamper_detected: "Tampered key",
  would_refuse: "Would have refused",
  refused: "Refused",
  limit_warning: "Limit warning",
  eula_accepted: "Terms accepted",
};

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

export function registerLicenceRoutes(app: FastifyInstance, licensing: LicenceService, options: { platformLogins: string[]; usage?: UsageService }): void {
  const operators = new Set(options.platformLogins.map((l) => l.toLowerCase()));

  const scope = () => {
    const s = licensing.scopeFor(currentTenant()?.id);
    if (s === null) throw new AppError("bad_request", "Open the customer's own site to see or install its licence.");
    return s;
  };

  /** Who may install a key: the installation's administrators; in SaaS, platform operators only. */
  const mayInstall = () => {
    const caller = currentCaller();
    return licensing.settings.tenancy ? !!caller && operators.has(caller.login.toLowerCase()) : !!caller?.isAdmin;
  };
  const assertMayInstall = () => {
    const caller = currentCaller();
    if (!mayInstall()) {
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
    const dto = licensing.toDto(await licensing.statusOf(s), { isAdmin: !!caller?.isAdmin, isStaff: caller?.kind === "staff" });
    // Limit warnings at 80% and 100%, for administrators (Build Guide, section 11).
    if (caller?.isAdmin && caller.kind === "staff" && options.usage) dto.banners.push(...(await options.usage.banners(s)));
    return dto;
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
      return await licensing.install(scope(), body.text, caller.login, body.confirmOlder === true, body.acceptEula === true);
    } catch (err) {
      if (err instanceof LicenceError) throw new AppError("bad_request", err.message);
      throw err;
    }
  });

  /** The licence page: summary, usage against every limit, history, EULA. */
  app.get("/api/licence", async (): Promise<LicenceDetail> => {
    const caller = assertAdmin();
    const s = scope();
    const status = await licensing.statusOf(s);
    const dto = licensing.toDto(status, { isAdmin: true, isStaff: caller.kind === "staff" });
    if (options.usage) dto.banners.push(...(await options.usage.banners(s)));
    const install = licensing.installation();
    const history = await licensing.history(s, 200);
    return {
      status: dto,
      summary: status.licence ? licensing.summary(status.licence) : null,
      usage: options.usage ? await options.usage.usage(s) : [],
      history: history.map((e) => ({
        id: e.id ?? 0,
        at: e.at.toISOString(),
        type: e.type,
        label: EVENT_LABELS[e.type] ?? e.type,
        actor: e.actor,
        detail: e.detail,
      })),
      canInstall: mayInstall(),
      deployment: licensing.settings.tenancy ? "saas" : "deployed",
      installation: licensing.settings.tenancy
        ? null
        : { id: install.id, reportKeyId: keyFingerprint(install.reportPublicKeyPem), reportPublicKey: install.reportPublicKeyPem },
      eula: {
        version: EULA_VERSION,
        text: EULA_TEXT,
        required: !status.eula,
        acceptedBy: status.eula?.by ?? null,
        acceptedAt: status.eula?.at.toISOString() ?? null,
      },
    };
  });

  /** Records acceptance of the EULA (deployed) or the terms of service (SaaS). */
  app.post("/api/licence/eula", async (_request, reply) => {
    const caller = assertAdmin();
    try {
      await licensing.acceptEula(scope(), caller.login);
    } catch (err) {
      if (err instanceof LicenceError) throw new AppError("bad_request", err.message);
      throw err;
    }
    reply.code(204);
    return null;
  });

  /** The signed usage report for a period (LIC-14), as a file. */
  app.get("/api/licence/usage-report", async (request, reply) => {
    assertAdmin();
    if (!options.usage) throw new AppError("not_found", "Usage is not counted on this server.");
    const q = parse(ReportQuery, request.query, "query");
    const s = scope();
    await options.usage.snapshot();
    const report = await options.usage.report(s, q.from, q.to);
    reply.header("Content-Disposition", `attachment; filename="arcus-usage-${s}-${q.from}-${q.to}.json"`);
    return report;
  });
}
