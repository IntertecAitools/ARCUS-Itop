import { AppError, badRequest } from "../../core/errors.js";
import { runAs, type Caller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { quoteString } from "../../itop/oql.js";

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
  constructor(private readonly client: ItopClient) {}

  async signIn(login: string, password: string): Promise<Caller> {
    const trimmed = login.trim();
    if (!trimmed || !password) throw badRequest("Enter your login and password.");

    if (!(await this.client.verifyCredentials(trimmed, password))) {
      // One message for both cases, so the form does not reveal which logins exist.
      throw new AppError("unauthorized", "Wrong login or password.");
    }

    const caller = await this.loadCaller(trimmed);
    if (caller.kind === "staff") {
      caller.credentials = { user: trimmed, password };
      await this.assertRestAccess(caller);
    }
    return caller;
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
    if (!(await this.client.verifyCredentials(caller.login, current))) {
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
