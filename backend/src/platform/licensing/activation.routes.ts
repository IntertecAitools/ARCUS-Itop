import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import { parse } from "../../core/validate.js";
import { activationRequest, readRevocationList } from "./activation.js";
import { LicenceError, type LicenceService } from "./licence.service.js";
import { INSTALLATION_SCOPE } from "./licence.store.js";
import type { ActivationResponse } from "./licence.types.js";
import { trustedKeys } from "./licence.verify.js";

export interface ActivationOptions {
  version: string;
  releaseDate?: string;
  clusterId?: string;
  /** Intertec's activation address: the request is sent there; otherwise it is a file. */
  activationUrl?: string;
  /** Intertec's signed revocation list, fetched daily. */
  revocationUrl?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const ActivationBody = z.object({
  orderRef: z.string().trim().max(64).default(""),
  /** Online, the licence that comes back is installed at once: the first one with the EULA accepted. */
  acceptEula: z.boolean().optional(),
});

/**
 * Deployed activation (Build Guide, section 10), on the licence page:
 * `POST /api/licence/activation-request` makes the installation's signed
 * request (installation id, cluster, report key, version, order). Online
 * (LICENCE_ACTIVATION_URL), it is sent to Intertec and the licence that
 * comes back is installed; offline, the administrator downloads it and
 * carries it to Intertec, then uploads the `.lic` that comes back.
 */
export function registerActivationRoutes(app: FastifyInstance, licensing: LicenceService, options: ActivationOptions): void {
  const doFetch = options.fetch ?? fetch;

  app.post("/api/licence/activation-request", async (request): Promise<ActivationResponse> => {
    const caller = currentCaller();
    if (licensing.settings.tenancy) throw new AppError("bad_request", "Activation is for deployed installations; SaaS tenants are licensed by the platform operator.");
    if (!caller?.isAdmin || caller.kind !== "staff") throw new AppError("forbidden", "Only administrators can activate the installation.");
    const body = parse(ActivationBody, request.body, "request body");
    const current = (await licensing.statusOf(INSTALLATION_SCOPE)).licence;
    const doc = await activationRequest(licensing.installation(), {
      version: options.version,
      ...(options.releaseDate ? { releaseDate: options.releaseDate } : {}),
      ...(options.clusterId ? { clusterId: options.clusterId } : {}),
      orderRef: body.orderRef,
      ...(current ? { currentLicenceId: current.licence_id } : {}),
      now: new Date(),
    });

    if (!options.activationUrl) {
      await licensing.event(INSTALLATION_SCOPE, "activation", caller.login, "Activation request created as a file, to send to Intertec.");
      return { mode: "offline", request: doc, installed: false, message: "Send this file to Intertec; upload the licence file that comes back." };
    }

    let message: string;
    try {
      const res = await doFetch(options.activationUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc),
        signal: AbortSignal.timeout(20_000),
      });
      const answer = (await res.json().catch(() => ({}))) as { licence?: unknown; message?: unknown };
      if (res.ok && typeof answer.licence === "string") {
        try {
          const result = await licensing.install(INSTALLATION_SCOPE, answer.licence, caller.login, false, body.acceptEula === true);
          message = `Activated: ${result.summary?.licenceId} installed.`;
          await licensing.event(INSTALLATION_SCOPE, "activation", caller.login, `Activation request sent to Intertec; ${message}`);
          return { mode: "online", installed: true, message };
        } catch (err) {
          if (!(err instanceof LicenceError)) throw err;
          message = `Intertec answered with a licence this installation refused: ${err.message}`;
        }
      } else {
        message = typeof answer.message === "string" ? `Intertec: ${answer.message}` : `Intertec's activation address answered ${res.status}.`;
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      message = `Intertec's activation address could not be reached (${(err as Error).message}). Download the request and send it instead.`;
    }
    await licensing.event(INSTALLATION_SCOPE, "activation", caller.login, `Activation request not completed: ${message}`);
    // The file always comes back too, so an administrator can fall back to sending it.
    return { mode: "online", request: doc, installed: false, message };
  });
}

/** Fetches and applies Intertec's signed revocation list (deployed, online). Never throws. */
export async function fetchRevocationList(licensing: LicenceService, url: string, doFetch: typeof fetch = fetch): Promise<string> {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return `revocation list: ${res.status}`;
    const list = readRevocationList(await res.text(), trustedKeys(licensing.settings.keys));
    if (!list.ok) {
      await licensing.event(INSTALLATION_SCOPE, "refused", null, `Revocation list refused: ${list.message}`);
      return list.message;
    }
    await licensing.applyRevocationList(list.list.revoked);
    return `revocation list applied: ${list.list.revoked.length} revoked`;
  } catch (err) {
    return `revocation list not fetched: ${(err as Error).message}`;
  }
}
