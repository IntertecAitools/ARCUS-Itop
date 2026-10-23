import * as oidc from "openid-client";

import type { SsoConfig } from "../../config/env.js";
import { AppError } from "../../core/errors.js";
import type { Sealer } from "./seal.js";

/** How long the round trip to the IdP may take. */
const STATE_TTL_MS = 10 * 60_000;
const STATE_BINDING = "sso-state";

interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

/** Who the IdP says signed in. */
export interface SsoIdentity {
  email: string;
  /** The IdP's stable id for the user (`sub`). */
  subject: string;
  /** Authentication methods (`amr`), lower case; empty when the IdP sent none. */
  amr: string[];
  /** Whether `amr` shows a second factor, by OIDC_MFA_AMR. */
  mfa: boolean;
}

/**
 * OpenID Connect single sign-on: Authorization Code flow with PKCE, a state
 * and a nonce. Written against the standard only, so Microsoft Entra ID (or
 * any OIDC provider) is a matter of OIDC_* settings.
 *
 * The state, nonce and PKCE verifier travel in a short-lived cookie sealed
 * with AES-GCM, not in server memory, so the callback may land on any BFF
 * instance. The ID token's signature, issuer, audience, expiry and nonce are
 * checked by openid-client.
 */
export class SsoService {
  private discovered?: Promise<oidc.Configuration>;

  constructor(
    readonly config: SsoConfig,
    private readonly sealer: Sealer,
    private readonly now: () => number = Date.now,
  ) {}

  /** The IdP's metadata, fetched once; a failure is retried on the next sign-in. */
  private configuration(): Promise<oidc.Configuration> {
    this.discovered ??= oidc
      .discovery(
        new URL(this.config.issuer),
        this.config.clientId,
        this.config.clientSecret,
        this.config.clientSecret ? oidc.ClientSecretPost(this.config.clientSecret) : oidc.None(),
        this.config.allowHttp ? { execute: [oidc.allowInsecureRequests] } : {},
      )
      .catch((error: unknown) => {
        this.discovered = undefined;
        throw new AppError("upstream_unavailable", "The single sign-on provider cannot be reached.", { cause: error });
      });
    return this.discovered;
  }

  /** Where to send the browser, and the sealed cookie that must come back with it. */
  async start(returnTo: string | undefined): Promise<{ url: string; cookie: string }> {
    const configuration = await this.configuration();
    const pending: PendingLogin = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(),
      returnTo: safeReturnTo(returnTo),
      expiresAt: this.now() + STATE_TTL_MS,
    };
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      response_type: "code",
      code_challenge: await oidc.calculatePKCECodeChallenge(pending.verifier),
      code_challenge_method: "S256",
      state: pending.state,
      nonce: pending.nonce,
    });
    const cookie = this.sealer.seal(JSON.stringify(pending), STATE_BINDING).toString("base64url");
    return { url: url.href, cookie };
  }

  /**
   * Finishes the round trip: checks the state, redeems the code with the PKCE
   * verifier, validates the ID token and reads who signed in.
   */
  async finish(query: string, cookie: string | undefined): Promise<{ identity: SsoIdentity; returnTo: string }> {
    const pending = this.openState(cookie);
    if (!pending) throw new AppError("unauthorized", "The sign-in took too long or was started elsewhere. Try again.");

    const params = new URLSearchParams(query);
    if (params.get("error")) {
      // The IdP's own refusal (user cancelled, no access to the app...).
      throw new AppError("unauthorized", `The sign-in provider refused: ${params.get("error_description") ?? params.get("error")}`);
    }

    // The URL the IdP redirected to: the registered redirect URI plus the
    // query, whatever host or proxy the request came through.
    const currentUrl = new URL(this.config.redirectUri);
    currentUrl.search = params.toString();

    const configuration = await this.configuration();
    let claims: oidc.IDToken | undefined;
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (error) {
      throw new AppError("unauthorized", "The sign-in could not be completed. Try again.", { cause: error });
    }
    if (!claims) throw new AppError("unauthorized", "The sign-in provider sent no ID token.");
    return { identity: this.identity(claims), returnTo: pending.returnTo };
  }

  private openState(cookie: string | undefined): PendingLogin | undefined {
    if (!cookie) return undefined;
    const json = this.sealer.open(Buffer.from(cookie, "base64url"), STATE_BINDING);
    if (!json) return undefined;
    const pending = JSON.parse(json) as PendingLogin;
    return pending.expiresAt > this.now() ? pending : undefined;
  }

  /** Reads the email address and the MFA evidence from the ID token's claims. */
  identity(claims: Record<string, unknown>): SsoIdentity {
    let email = "";
    for (const name of this.config.emailClaims) {
      const value = claims[name];
      if (typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value.trim())) {
        // An IdP that says the address is unverified is not proof of who this is.
        if (name === "email" && claims["email_verified"] === false) continue;
        email = value.trim();
        break;
      }
    }
    if (!email) {
      throw new AppError("forbidden", "The sign-in provider did not give an email address for this account.");
    }
    const amr = Array.isArray(claims["amr"]) ? claims["amr"].map((v) => String(v).toLowerCase()) : [];
    return {
      email,
      subject: String(claims["sub"] ?? ""),
      amr,
      mfa: amr.some((method) => this.config.mfaAmr.includes(method)),
    };
  }

  /** The frontend address to land on, with an error code when sign-in failed. */
  landing(returnTo: string, error?: string): string {
    const base = this.config.appUrl === "/" ? "" : this.config.appUrl;
    if (!error) return `${base}${returnTo}`;
    return `${base}/login?sso_error=${encodeURIComponent(error)}`;
  }
}

/** Only a path on our own site: never another host (no open redirect). */
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value.slice(0, 500);
}
