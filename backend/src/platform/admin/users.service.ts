import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount } from "../../itop/normalize.js";
import { likeContains } from "../../itop/oql.js";
import type { ObjectsService } from "../objects/objects.service.js";
import { ADMIN_PROFILE, PORTAL_PROFILE, REST_PROFILE, type AuthService } from "../auth/auth.service.js";
import type { SessionStore } from "../auth/session.store.js";
import type { TenantResolver } from "../tenancy/resolve.js";

export type AccountType = "local" | "ldap" | "external";

const CLASS_BY_TYPE: Record<AccountType, string> = {
  local: "UserLocal",
  ldap: "UserLDAP",
  external: "UserExternal",
};
const TYPE_BY_CLASS: Record<string, AccountType> = {
  UserLocal: "local",
  UserLDAP: "ldap",
  UserExternal: "external",
};

export interface UserSummary {
  id: number;
  login: string;
  type: AccountType | "other";
  status: "enabled" | "disabled";
  name: string;
  email: string;
  contactId: number;
  profiles: string[];
}

export interface UserDetail extends UserSummary {
  profileIds: number[];
  allowedOrgs: { id: number; name: string }[];
  language: string;
}

export interface Profile {
  id: number;
  name: string;
  description: string;
  /** Whether the signed-in administrator may give or take away this profile. */
  grantable: boolean;
}

/**
 * Profiles only a platform operator gives or takes away. A customer's own
 * administrator (one bound to a tenant) manages their people's other
 * profiles, but cannot make or unmake an administrator, nor change another
 * administrator's account (a password reset there would be a takeover).
 */
export const OPERATOR_PROFILES: readonly string[] = [ADMIN_PROFILE];

export interface CreateUserInput {
  type: AccountType;
  login: string;
  /** Local accounts only. */
  password?: string;
  /** An existing Person, or the details of a new one. */
  contact: { id: number } | { firstName: string; lastName: string; email: string; orgId: number };
  profileIds: number[];
  allowedOrgIds?: number[];
  language?: string;
}

export interface UpdateUserInput {
  status?: "enabled" | "disabled";
  profileIds?: number[];
  allowedOrgIds?: number[];
  contactId?: number;
  language?: string;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const USER_FIELDS = "id,login,status,contactid,first_name,last_name,email,language";

/**
 * Account administration, so nobody needs iTop's own console for it.
 *
 * Accounts stay iTop's -- UserLocal, UserLDAP, UserExternal with their
 * URP_UserProfile and URP_UserOrg links -- and are written through the REST
 * API as the signed-in administrator, so iTop still decides who may manage
 * accounts. These classes are deliberately outside the generic object API.
 *
 * Staff need iTop's "REST Services User" profile to use this platform at all
 * (they call iTop as themselves), so it is added to every staff account here
 * rather than left for an administrator to remember.
 */
export class UsersService {
  private restProfileId?: number;

  constructor(
    private readonly client: ItopClient,
    private readonly objects: ObjectsService,
    private readonly auth: AuthService,
    private readonly sessions: SessionStore,
    private readonly tenancy?: TenantResolver,
  ) {}

  /**
   * With tenancy on, an account's organisations are its own tenant's: the
   * tenant of its person's organisation. Allowed organisations from another
   * tenant are refused, and an empty list (iTop reads it as "every
   * organisation") becomes the tenant's own, so iTop's silos hold the
   * account to its tenant as well. Unchanged when tenancy is off or the
   * person belongs to no tenant (a platform operator's).
   */
  private async tenantOrgs(contactId: number, allowedOrgIds: number[] | undefined): Promise<number[] | undefined> {
    if (!this.tenancy?.enabled) return allowedOrgIds;
    const person = contactId > 0 ? await this.objects.get("Person", contactId, "id,org_id") : undefined;
    const orgId = Number(person?.fields["org_id"]) || 0;
    const tenant = orgId > 0 ? await this.tenancy.tenantOfOrg(orgId) : undefined;
    const others = await Promise.all((allowedOrgIds ?? []).map((id) => this.tenancy!.tenantOfOrg(id)));
    if (!tenant) {
      if (others.some(Boolean)) {
        throw badRequest("This person belongs to no customer, so the account cannot be given a customer's organisations.");
      }
      return allowedOrgIds;
    }
    const outside = (allowedOrgIds ?? []).filter((_, i) => others[i]?.id !== tenant.id);
    if (outside.length) {
      throw badRequest(
        `An account can only be given organisations of its own customer (${tenant.name}); ` +
          `organisation${outside.length === 1 ? "" : "s"} ${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not.`,
      );
    }
    return allowedOrgIds && allowedOrgIds.length > 0 ? allowedOrgIds : [...tenant.orgIds];
  }

  async list(query: { q?: string; page: number; limit: number }) {
    const term = query.q?.trim();
    const where = term
      ? ` WHERE login LIKE ${likeContains(term)} OR first_name LIKE ${likeContains(term)} ` +
        `OR last_name LIKE ${likeContains(term)} OR email LIKE ${likeContains(term)}`
      : "";
    const result = await this.client.call("core/get", {
      class: "User",
      key: `SELECT User${where}`,
      output_fields: USER_FIELDS,
      limit: query.limit,
      page: query.page,
    });
    const users = normalizeObjects(result.objects);
    const total = parseFoundCount(result.message) ?? users.length;
    const profiles = await this.profilesOf(users.map((u) => u.id));

    return {
      items: users.map((u) => this.summary(u, profiles.get(u.id) ?? [])),
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async get(id: number): Promise<UserDetail> {
    const result = await this.client.call("core/get", { class: "User", key: id, output_fields: USER_FIELDS });
    const user = normalizeObjects(result.objects)[0];
    if (!user) throw notFound(`No account with id ${id}.`);
    const [profiles, orgs] = await Promise.all([
      this.client.call("core/get", {
        class: "URP_UserProfile",
        key: `SELECT URP_UserProfile WHERE userid = ${id}`,
        output_fields: "profileid,profile",
      }),
      this.client.call("core/get", {
        class: "URP_UserOrg",
        key: `SELECT URP_UserOrg WHERE userid = ${id}`,
        output_fields: "allowed_org_id,allowed_org_name",
      }),
    ]);
    const profileRows = normalizeObjects(profiles.objects);
    return {
      ...this.summary(user, profileRows.map((p) => str(p.fields["profile"]))),
      profileIds: profileRows.map((p) => Number(p.fields["profileid"])).filter((n) => n > 0),
      allowedOrgs: normalizeObjects(orgs.objects).map((o) => ({
        id: Number(o.fields["allowed_org_id"]),
        name: str(o.fields["allowed_org_name"]),
      })),
      language: str(user.fields["language"]),
    };
  }

  async profiles(): Promise<Profile[]> {
    const result = await this.client.call("core/get", {
      class: "URP_Profiles",
      key: "SELECT URP_Profiles",
      output_fields: "id,name,description",
    });
    const limited = this.tenantAdmin();
    return normalizeObjects(result.objects)
      .map((p) => {
        const name = str(p.fields["name"]);
        return { id: p.id, name, description: str(p.fields["description"]), grantable: !limited || !OPERATOR_PROFILES.includes(name) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A customer's administrator: an administrator held to a tenant, rather than the platform operator. */
  private tenantAdmin(): boolean {
    return Boolean(this.tenancy?.enabled && currentTenant());
  }

  /** Refuses giving or taking away a profile the signed-in administrator may not grant. */
  private async assertGrantable(changed: number[]): Promise<void> {
    if (!this.tenantAdmin() || changed.length === 0) return;
    const reserved = (await this.profiles()).filter((p) => !p.grantable && changed.includes(p.id));
    if (reserved.length) {
      throw new AppError(
        "forbidden",
        `Only the platform operator can give or take away ${reserved.map((p) => p.name).join(", ")}.`,
      );
    }
  }

  /** Refuses a customer administrator changing another administrator's account. */
  private async assertNotOtherAdmin(target: UserDetail): Promise<void> {
    if (!this.tenantAdmin() || currentCaller()?.userId === target.id) return;
    const reserved = (await this.profiles()).filter((p) => !p.grantable).map((p) => p.id);
    if (target.profileIds.some((id) => reserved.includes(id))) {
      throw new AppError("forbidden", "Another administrator's account is changed by the platform operator.");
    }
  }

  async create(input: CreateUserInput): Promise<UserDetail> {
    const login = input.login.trim();
    if (!/^[^\s'"\\]{2,64}$/.test(login)) {
      throw badRequest("A login is 2 to 64 characters, without spaces or quotes.");
    }
    if (input.type === "local" && (!input.password || input.password.length < 8)) {
      throw badRequest("A local account needs a password of at least 8 characters.");
    }
    if (input.profileIds.length === 0) throw badRequest("Give the account at least one profile.");
    await this.assertGrantable(input.profileIds);

    if (!("id" in input.contact) && this.tenancy?.enabled) {
      // The new person's organisation decides the tenant: check before creating it.
      const tenant = await this.tenancy.tenantOfOrg(input.contact.orgId);
      const others = await Promise.all((input.allowedOrgIds ?? []).map((id) => this.tenancy!.tenantOfOrg(id)));
      if (others.some((t) => t?.id !== tenant?.id)) {
        throw badRequest("An account can only be given organisations of its own customer.");
      }
    }
    const contactId = "id" in input.contact ? input.contact.id : await this.createPerson(input.contact);
    const profileIds = await this.withRestProfile(input.profileIds);
    const allowedOrgIds = await this.tenantOrgs(contactId, input.allowedOrgIds);

    const fields: Record<string, unknown> = {
      login,
      contactid: contactId,
      status: "enabled",
      profile_list: profileIds.map((profileid) => ({ profileid })),
      allowed_org_list: (allowedOrgIds ?? []).map((allowed_org_id) => ({ allowed_org_id })),
    };
    if (input.type === "local") fields["password"] = input.password;
    if (input.language) fields["language"] = input.language;

    const created = await this.client.call("core/create", {
      class: CLASS_BY_TYPE[input.type],
      fields,
      output_fields: "id",
      comment: `Account created by ${currentCaller()?.login ?? "the platform"}`,
    });
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no account.");
    return this.get(row.id);
  }

  async update(id: number, input: UpdateUserInput): Promise<UserDetail> {
    const self = currentCaller()?.userId === id;
    const current = await this.get(id);
    await this.assertNotOtherAdmin(current);
    if (input.profileIds) {
      const next = input.profileIds;
      await this.assertGrantable([
        ...next.filter((p) => !current.profileIds.includes(p)),
        ...current.profileIds.filter((p) => !next.includes(p)),
      ]);
    }

    // An administrator cannot lock themselves out of administration.
    if (self && input.status === "disabled") throw badRequest("You cannot disable your own account.");
    if (self && input.profileIds) {
      const adminId = (await this.profiles()).find((p) => p.name === ADMIN_PROFILE)?.id;
      if (adminId && current.profileIds.includes(adminId) && !input.profileIds.includes(adminId)) {
        throw badRequest("You cannot remove your own Administrator profile.");
      }
    }

    const fields: Record<string, unknown> = {};
    if (input.status) fields["status"] = input.status;
    if (input.contactId !== undefined) fields["contactid"] = input.contactId;
    if (input.language) fields["language"] = input.language;
    // A link set written over REST replaces the whole set, which is the
    // intended "these are the profiles now" semantics.
    if (input.profileIds) {
      if (input.profileIds.length === 0) throw badRequest("An account needs at least one profile.");
      fields["profile_list"] = (await this.withRestProfile(input.profileIds)).map((profileid) => ({ profileid }));
    }
    if (input.allowedOrgIds || (input.contactId !== undefined && this.tenancy?.enabled)) {
      const contactId = input.contactId ?? current.contactId;
      const allowed = await this.tenantOrgs(contactId, input.allowedOrgIds ?? current.allowedOrgs.map((o) => o.id));
      fields["allowed_org_list"] = (allowed ?? []).map((allowed_org_id) => ({ allowed_org_id }));
    }
    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");

    await this.client.call("core/update", {
      class: "User",
      key: id,
      fields,
      output_fields: "id",
      comment: `Account updated by ${currentCaller()?.login ?? "the platform"}`,
    });

    // Rights, status and the linked person are read at sign-in (the person
    // scopes the portal and the inbox), so a changed account signs in again.
    if (!self && (input.status || input.profileIds || input.allowedOrgIds || input.contactId !== undefined)) {
      await this.sessions.deleteForUser(id);
    }
    return this.get(id);
  }

  /** An administrator sets a local account's password; the user is signed out everywhere. */
  async setPassword(id: number, password: string): Promise<void> {
    if (password.length < 8) throw badRequest("Choose a password of at least 8 characters.");
    await this.assertNotOtherAdmin(await this.get(id));
    await this.auth.setLocalPassword(id, password, `Password reset by ${currentCaller()?.login ?? "an administrator"}`);
    if (currentCaller()?.userId !== id) await this.sessions.deleteForUser(id);
  }

  private summary(user: { id: number; class: string; fields: Record<string, unknown> }, profiles: string[]): UserSummary {
    const f = user.fields;
    return {
      id: user.id,
      login: str(f["login"]),
      type: TYPE_BY_CLASS[user.class] ?? "other",
      status: str(f["status"]) === "disabled" ? "disabled" : "enabled",
      name: [str(f["first_name"]), str(f["last_name"])].filter(Boolean).join(" "),
      email: str(f["email"]),
      contactId: Number(f["contactid"]) || 0,
      profiles,
    };
  }

  private async profilesOf(userIds: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (userIds.length === 0) return out;
    const result = await this.client.call("core/get", {
      class: "URP_UserProfile",
      key: `SELECT URP_UserProfile WHERE userid IN (${userIds.join(",")})`,
      output_fields: "userid,profile",
    });
    for (const row of normalizeObjects(result.objects)) {
      const uid = Number(row.fields["userid"]);
      out.set(uid, [...(out.get(uid) ?? []), str(row.fields["profile"])]);
    }
    return out;
  }

  /** Staff accounts get iTop's REST profile; end-user (portal) accounts never do. */
  private async withRestProfile(profileIds: number[]): Promise<number[]> {
    const all = await this.profiles();
    const portalId = all.find((p) => p.name === PORTAL_PROFILE)?.id;
    if (portalId && profileIds.includes(portalId)) return [...new Set(profileIds)];
    this.restProfileId ??= all.find((p) => p.name === REST_PROFILE)?.id;
    if (!this.restProfileId) return [...new Set(profileIds)];
    return [...new Set([...profileIds, this.restProfileId])];
  }

  private async createPerson(contact: { firstName: string; lastName: string; email: string; orgId: number }) {
    const { object } = await this.objects.create(
      "Person",
      { first_name: contact.firstName, name: contact.lastName, email: contact.email, org_id: contact.orgId },
      { fields: "id", comment: `Contact created with a new account` },
    );
    return object.id;
  }
}
