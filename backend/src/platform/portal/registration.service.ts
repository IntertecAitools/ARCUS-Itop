import { randomBytes } from "node:crypto";

import { AppError, badRequest } from "../../core/errors.js";
import { RateLimiter } from "../../core/rate-limiter.js";
import { currentTenant, runAsServiceAccount, runUnscoped } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { quoteString } from "../../itop/oql.js";
import { PORTAL_PROFILE } from "../auth/auth.service.js";
import type { PasswordResetService } from "../auth/password-reset.service.js";
import type { TenantResolver } from "../tenancy/resolve.js";
import { tenantOfEmail, type Tenant } from "../tenancy/tenant.store.js";

const PER_ADDRESS = 5;
const WINDOW_MS = 15 * 60_000;

export interface RegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * End users join by their email domain (SELF_REGISTRATION=on, with tenancy
 * and password reset by email): an address at a domain a tenant has claimed
 * gets a portal account in that domain's organisation.
 *
 * The address is proved before anyone can sign in: the account is created
 * with a random password nobody knows, and the only way in is the "set your
 * password" link mailed to it (the password-reset flow). So a registration
 * in someone else's name gives the registrant nothing. The answer is the
 * same whether or not an account already existed (an existing one simply
 * gets a reset link), so it does not reveal who has one.
 *
 * Single sign-on with an IdP-verified address at a claimed domain and no
 * account gets the same portal account (`provision`), and signs in at once.
 */
export class RegistrationService {
  private readonly byAddress: RateLimiter;

  constructor(
    private readonly client: ItopClient,
    private readonly tenancy: TenantResolver,
    private readonly passwordReset: PasswordResetService,
    private readonly on: boolean,
    now: () => number = Date.now,
  ) {
    this.byAddress = new RateLimiter(PER_ADDRESS, WINDOW_MS, now);
  }

  /** Whether the sign-in page offers "Create an account". */
  get enabled(): boolean {
    return this.on && this.tenancy.enabled && this.passwordReset.enabled;
  }

  /** Whether an unknown single sign-on address at a claimed domain gets an account. */
  get provisions(): boolean {
    return this.on && this.tenancy.enabled;
  }

  /**
   * Checks a registration and returns the work to do after answering, like
   * PasswordResetService.request: the caller answers first.
   */
  async register(input: RegistrationInput, address: string): Promise<() => Promise<void>> {
    if (!this.enabled) throw new AppError("not_found", "Self-registration is not available on this platform.");
    const email = input.email.trim().toLowerCase();
    if (!input.lastName.trim()) throw badRequest("Enter your last name.");
    if (!this.byAddress.allow(address)) {
      throw new AppError("rate_limited", "Too many requests. Try again in a few minutes.");
    }
    const target = await this.targetOf(email);
    const reset = this.passwordReset.request(email, address);
    return async () => {
      await this.ensureAccount(target, email, input.firstName.trim(), input.lastName.trim());
      await reset();
    };
  }

  /**
   * A portal account for a single sign-on address nobody has yet. False when
   * no tenant claims the domain (the sign-in is then refused as before).
   */
  async provision(email: string): Promise<boolean> {
    if (!this.provisions) return false;
    const address = email.trim().toLowerCase();
    let target: { tenant: Tenant; orgId: number };
    try {
      target = await this.targetOf(address);
    } catch {
      return false;
    }
    const local = address.split("@")[0] ?? address;
    await this.ensureAccount(target, address, "", local);
    return true;
  }

  /** The tenant and organisation an address joins; refuses one this site does not serve. */
  private async targetOf(email: string): Promise<{ tenant: Tenant; orgId: number }> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Enter a valid email address.");
    const hit = tenantOfEmail(email, await this.tenancy.tenants());
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!hit) {
      throw badRequest(`No organisation on this service uses ${domain} addresses. Ask your IT team for an account.`);
    }
    if (hit.tenant.status === "disabled") throw new AppError("forbidden", "Your organisation's access to this platform is suspended.");
    const site = currentTenant();
    if (site && site.id !== hit.tenant.id) {
      throw badRequest(`${domain} addresses belong to another organisation's site. Register there.`);
    }
    return hit;
  }

  /** Creates the person and the portal account unless the address already has an account. */
  private async ensureAccount(target: { tenant: Tenant; orgId: number }, email: string, firstName: string, lastName: string) {
    // Looked up across tenants (an address may already have an account
    // anywhere) and written as the service account: nobody is signed in.
    await runUnscoped(() =>
      runAsServiceAccount(async () => {
        const existing = await this.client.call(
          "core/get",
          {
            class: "User",
            key: `SELECT User WHERE login = ${quoteString(email)} OR email = ${quoteString(email)}`,
            output_fields: "id",
            limit: 1,
          },
          { asService: true },
        );
        if (normalizeObjects(existing.objects).length > 0) return;

        const people = await this.client.call(
          "core/get",
          {
            class: "Person",
            key: `SELECT Person WHERE email = ${quoteString(email)} AND org_id = ${target.orgId}`,
            output_fields: "id",
            limit: 1,
          },
          { asService: true },
        );
        let personId = normalizeObjects(people.objects)[0]?.id;
        if (!personId) {
          const created = await this.client.call(
            "core/create",
            {
              class: "Person",
              fields: { first_name: firstName, name: lastName, email, org_id: target.orgId },
              output_fields: "id",
              comment: "Contact created by self-registration",
            },
            { asService: true },
          );
          personId = normalizeObjects(created.objects)[0]?.id;
        }
        const profiles = await this.client.call(
          "core/get",
          { class: "URP_Profiles", key: `SELECT URP_Profiles WHERE name = ${quoteString(PORTAL_PROFILE)}`, output_fields: "id" },
          { asService: true },
        );
        const portalId = normalizeObjects(profiles.objects)[0]?.id;
        if (!personId || !portalId) throw new AppError("upstream_error", "The account could not be created.");
        await this.client.call(
          "core/create",
          {
            class: "UserLocal",
            fields: {
              login: email,
              contactid: personId,
              status: "enabled",
              // Never told to anyone: the mailed link sets the real one.
              password: `${randomBytes(24).toString("base64url")}aA1!`,
              profile_list: [{ profileid: portalId }],
              allowed_org_list: [{ allowed_org_id: target.orgId }],
            },
            output_fields: "id",
            comment: `Portal account created by self-registration (${target.tenant.name})`,
          },
          { asService: true },
        );
      }),
    );
  }
}
