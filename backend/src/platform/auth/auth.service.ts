import type { SignInPolicy } from "../../config/env.js";
import { AppError, badRequest } from "../../core/errors.js";
import { RateLimiter } from "../../core/rate-limiter.js";
import { runAs, type Caller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { quoteString } from "../../itop/oql.js";
import type { SsoIdentity } from "./sso.service.js";

export interface AuthOptions {
  /** MFA, single sign-on and break-glass rules; absent means password only. */
  policy?: SignInPolicy;
  /** ITOP_EXTERNAL_AUTH_HEADER is set: staff signed in by SSO can call iTop. */
  externalItopAuth?: boolean;
}

/** iTop's profile names (datamodels/2.x/itop-profiles-itil, core). */
export const PORTAL_PROFILE = "Portal user";
export const ADMIN_PROFILE = "Administrator";
export const REST_PROFILE = "REST Services User";

/** What the frontend learns about the signed-in user. Never the credentials. */
export interface PublicUser {
  id: number;
  login: string;
  name: string;
  email: string;
  kind: Caller["kind"];
  profiles: string[];
  isAdmin: boolean;
  contactId: number;
  orgId: number;
}

export function publicUser(caller: Caller): PublicUser {
  return {
    id: caller.userId,
    login: caller.login,
    name: caller.name,
    email: caller.email,
    kind: caller.kind,
    profiles: caller.profiles,
    isAdmin: caller.isAdmin,
    contactId: caller.contactId,
    orgId: caller.orgId,
  };
}

/**
 * Failed sign-ins allowed per window: per client address (one source trying
 * many logins) and per login (many sources trying one). A successful sign-in
 * clears its login's count. Per BFF instance, like every RateLimiter.
 */
export const SIGN_IN_LIMITS = { perAddress: 10, perLogin: 5, windowMs: 15 * 60_000 } as const;

/**
 * Wrong authenticator or recovery codes allowed per login per window. Kept
 * apart from the password count, which a correct password clears: whoever
 * is at this step knows the password.
 */
export const MFA_CODE_LIMIT = 10;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Sign-in against iTop's own accounts.
 *
 * The password is checked with core/check_credentials, which covers local,
 * LDAP and external accounts. The account, its profiles and its allowed
 * organisations are then read with the service account, which is how the BFF
 * knows whether this is staff (works in the agent screens, as themselves) or
 * an end user (iTop's REST API refuses them; they get the self-service API).
 */
export class AuthService {
  private readonly failuresByAddress: RateLimiter;
  private readonly failuresByLogin: RateLimiter;
  private readonly codeFailuresByLogin: RateLimiter;

  constructor(
    private readonly client: ItopClient,
    now: () => number = Date.now,
    private readonly options: AuthOptions = {},
  ) {
    this.failuresByAddress = new RateLimiter(SIGN_IN_LIMITS.perAddress, SIGN_IN_LIMITS.windowMs, now);
    this.failuresByLogin = new RateLimiter(SIGN_IN_LIMITS.perLogin, SIGN_IN_LIMITS.windowMs, now);
    this.codeFailuresByLogin = new RateLimiter(MFA_CODE_LIMIT, SIGN_IN_LIMITS.windowMs, now);
  }

  /** `address` is the client's, as the request saw it (TRUST_PROXY decides how). */
  async signIn(login: string, password: string, address: string): Promise<Caller> {
    const trimmed = login.trim();
    if (!trimmed || !password) throw badRequest("Enter your login and password.");

    // Checked before the password, so a blocked guess never reaches iTop. The
    // same answer whether or not the login exists.
    const loginKey = trimmed.toLowerCase();
    this.assertNotThrottled(loginKey, address);

    if (!(await this.client.verifyCredentials(trimmed, password))) {
      this.failuresByAddress.record(address);
      this.failuresByLogin.record(loginKey);
      // One message for both cases, so the form does not reveal which logins exist.
      throw new AppError("unauthorized", "Wrong login or password.");
    }
    this.failuresByLogin.clear(loginKey);

    const caller = await this.loadCaller(trimmed);
    const breakGlass = this.isBreakGlass(caller.login);
    this.assertPasswordSignInAllowed(caller, breakGlass);
    caller.signIn = { method: breakGlass ? "break-glass" : "password" };
    if (caller.kind === "staff") {
      caller.credentials = { user: trimmed, password };
      await this.assertRestAccess(caller);
    }
    return caller;
  }

  isBreakGlass(login: string): boolean {
    return this.options.policy?.breakGlassLogins.includes(login.toLowerCase()) ?? false;
  }

  /**
   * PASSWORD_SIGN_IN: with single sign-on in place, passwords may be kept to
   * end users and break-glass accounts, or to break-glass accounts alone.
   * Checked after the password, so the answer reveals nothing about a login
   * to someone who does not know its password.
   */
  private assertPasswordSignInAllowed(caller: Caller, breakGlass: boolean): void {
    const rule = this.options.policy?.passwordSignIn ?? "all";
    if (rule === "all" || breakGlass) return;
    if (rule === "portal" && caller.kind === "portal") return;
    const label = this.options.policy?.sso?.label ?? "single sign-on";
    throw new AppError("forbidden", `This account signs in with single sign-on. Use "${label}".`);
  }

  /**
   * Single sign-on: the IdP vouched for an email address, which must belong
   * to exactly one enabled iTop account, linked to an active person. Unknown
   * and disabled users are refused; nobody is created here.
   *
   * Staff then call iTop as themselves through iTop's "external" login, which
   * needs a UserExternal account (iTop's kind for users authenticated
   * elsewhere) and ITOP_EXTERNAL_AUTH_HEADER. End users need neither: the
   * self-service API runs as the service account.
   */
  async signInWithSso(identity: SsoIdentity): Promise<Caller> {
    const found = await this.client.call(
      "core/get",
      {
        class: "User",
        key: `SELECT User WHERE email = ${quoteString(identity.email)}`,
        output_fields: "id,login,status",
        limit: 5,
      },
      { asService: true },
    );
    const accounts = normalizeObjects(found.objects);
    if (accounts.length === 0) {
      throw new AppError(
        "forbidden",
        `No helpdesk account belongs to ${identity.email}. Ask an administrator to create one.`,
      );
    }
    const enabled = accounts.filter((a) => str(a.fields["status"]) !== "disabled");
    if (enabled.length === 0) {
      throw new AppError("forbidden", "This account is disabled. Ask an administrator to enable it.");
    }
    if (enabled.length > 1) {
      throw new AppError(
        "forbidden",
        `Several helpdesk accounts belong to ${identity.email}, so single sign-on cannot tell which is yours. ` +
          `Ask an administrator to keep one.`,
      );
    }
    const account = enabled[0]!;
    const caller = await this.loadCaller(str(account.fields["login"]));
    await this.assertPersonActive(caller);
    caller.signIn = { method: "sso" };

    if (caller.kind === "staff") {
      if (account.class !== "UserExternal") {
        throw new AppError(
          "forbidden",
          `Your account (${caller.login}) signs in with a password, not single sign-on. ` +
            `Ask an administrator to make it an external account, or sign in with your password.`,
        );
      }
      if (!this.options.externalItopAuth) {
        throw new AppError("forbidden", "Single sign-on is not available to staff yet: iTop is not set up for it.");
      }
      caller.credentials = { user: caller.login, external: true };
      await this.assertRestAccess(caller);
    }
    return caller;
  }

  /** A person marked inactive in iTop has left: their account does not sign in by SSO either. */
  private async assertPersonActive(caller: Caller): Promise<void> {
    if (!caller.contactId) return;
    const people = await this.client.call(
      "core/get",
      { class: "Person", key: caller.contactId, output_fields: "status" },
      { asService: true },
    );
    const person = normalizeObjects(people.objects)[0];
    if (person && str(person.fields["status"]) === "inactive") {
      throw new AppError("forbidden", "This account belongs to someone marked inactive. Ask an administrator.");
    }
  }

  /**
   * A wrong authenticator or recovery code: counted per address like a wrong
   * password, and per login on a count of its own that no password clears.
   */
  recordWrongCode(login: string, address: string): void {
    this.failuresByAddress.record(address);
    this.codeFailuresByLogin.record(login.toLowerCase());
  }

  /** Throws rate_limited while a login cannot try another authenticator code. */
  assertCodeNotThrottled(login: string, address: string): void {
    this.assertNotThrottled(login.toLowerCase(), address, this.codeFailuresByLogin.retryAfterMs(login.toLowerCase()));
  }

  private assertNotThrottled(loginKey: string, address?: string, extraWaitMs = 0): void {
    const waitMs = Math.max(
      extraWaitMs,
      address === undefined ? 0 : this.failuresByAddress.retryAfterMs(address),
      this.failuresByLogin.retryAfterMs(loginKey),
    );
    if (waitMs > 0) {
      const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
      throw new AppError(
        "rate_limited",
        `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        { details: { retryAfterSeconds: Math.ceil(waitMs / 1000) } },
      );
    }
  }

  /** Reads the account behind a login, with the service account. */
  async loadCaller(login: string): Promise<Caller> {
    const users = await this.client.call(
      "core/get",
      {
        class: "User",
        key: `SELECT User WHERE login = ${quoteString(login)}`,
        output_fields: "id,login,status,contactid,first_name,last_name,email,org_id",
        limit: 1,
      },
      { asService: true },
    );
    const user = normalizeObjects(users.objects)[0];
    if (!user) throw new AppError("unauthorized", "Wrong login or password.");
    const f = user.fields;
    if (str(f["status"]) === "disabled") {
      throw new AppError("forbidden", "This account is disabled. Ask an administrator to enable it.");
    }

    const [profiles, orgs] = await Promise.all([
      this.client.call(
        "core/get",
        {
          class: "URP_UserProfile",
          key: `SELECT URP_UserProfile WHERE userid = ${user.id}`,
          output_fields: "profile",
        },
        { asService: true },
      ),
      this.client.call(
        "core/get",
        {
          class: "URP_UserOrg",
          key: `SELECT URP_UserOrg WHERE userid = ${user.id}`,
          output_fields: "allowed_org_id",
        },
        { asService: true },
      ),
    ]);

    const profileNames = normalizeObjects(profiles.objects).map((p) => str(p.fields["profile"])).filter(Boolean);
    const name = [str(f["first_name"]), str(f["last_name"])].filter(Boolean).join(" ") || login;

    return {
      userId: user.id,
      login,
      contactId: Number(f["contactid"]) || 0,
      name,
      email: str(f["email"]),
      // iTop treats any account holding the Portal user profile as an end
      // user (UserRightsProfile::IsPortalUser) and routes it to the portal.
      kind: profileNames.includes(PORTAL_PROFILE) ? "portal" : "staff",
      profiles: profileNames,
      isAdmin: profileNames.includes(ADMIN_PROFILE),
      allowedOrgIds: normalizeObjects(orgs.objects)
        .map((o) => Number(o.fields["allowed_org_id"]))
        .filter((n) => n > 0),
      orgId: Number(f["org_id"]) || 0,
    };
  }

  /**
   * Staff call iTop as themselves, so their account must be allowed on the
   * REST API: with secure_rest_services on (iTop's default) that takes the
   * "REST Services User" profile. Checked at sign-in so the problem is one
   * clear message, not a failure on every screen afterwards.
   */
  private async assertRestAccess(caller: Caller): Promise<void> {
    try {
      await runAs(caller, () => this.client.call("list_operations", {}));
    } catch (error) {
      // Only the profile message means the profile: an external login iTop
      // did not take (ext_auth_variable not reading our header) comes back as
      // a missing auth_user or an invalid login.
      if (
        error instanceof AppError &&
        error.code === "forbidden" &&
        caller.credentials &&
        !("password" in caller.credentials) &&
        !/not authorized to use the web services/i.test(error.message)
      ) {
        throw new AppError(
          "forbidden",
          "iTop did not accept the single sign-on login. An administrator needs to finish setting it up " +
            "(iTop's ext_auth_variable and ITOP_EXTERNAL_AUTH_HEADER).",
        );
      }
      if (error instanceof AppError && error.code === "forbidden") {
        throw new AppError(
          "forbidden",
          `Your account cannot use this platform yet: it needs the "${REST_PROFILE}" profile. ` +
            `Ask an administrator to add it.`,
        );
      }
      throw error;
    }
  }

  /**
   * Changes the signed-in user's own password. The current one is checked
   * first; the write uses the service account, because ordinary profiles may
   * not edit accounts in iTop. Local accounts only -- an LDAP password lives
   * in the directory.
   */
  async changeOwnPassword(caller: Caller, current: string, next: string): Promise<void> {
    // A wrong current password counts against the login like a failed
    // sign-in, so a borrowed session cannot be used to guess it.
    const loginKey = caller.login.toLowerCase();
    this.assertNotThrottled(loginKey);
    if (!(await this.client.verifyCredentials(caller.login, current))) {
      this.failuresByLogin.record(loginKey);
      throw badRequest("Your current password is not correct.");
    }
    if (next.length < 8) throw badRequest("Choose a password of at least 8 characters.");
    await this.setLocalPassword(caller.userId, next, "Password changed by the user");
  }

  /** Sets a UserLocal's password with the service account. */
  async setLocalPassword(userId: number, password: string, comment: string): Promise<void> {
    const found = await this.client.call(
      "core/get",
      { class: "User", key: userId, output_fields: "id" },
      { asService: true },
    );
    const account = normalizeObjects(found.objects)[0];
    if (!account) throw new AppError("not_found", `No account with id ${userId}.`);
    if (account.class !== "UserLocal") {
      throw badRequest("This account's password is managed outside the platform (LDAP or external sign-in).");
    }
    await this.client.call(
      "core/update",
      { class: "UserLocal", key: userId, fields: { password }, output_fields: "id", comment },
      { asService: true },
    );
  }
}
