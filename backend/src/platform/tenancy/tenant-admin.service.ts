import { createHash } from "node:crypto";

import { AppError, badRequest, notFound } from "../../core/errors.js";
import { currentCaller, currentTenant, runUnscoped } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { likeContains } from "../../itop/oql.js";
import type { TenantResolver } from "./resolve.js";
import {
  isEmailDomain,
  normalizeDomain,
  validateBranding,
  type EmailDomain,
  type Tenant,
  type TenantBranding,
  type TenantStore,
} from "./tenant.store.js";

/** What the site shows for a tenant. The logo is a URL under the API, never inline. */
export interface BrandingView {
  productName?: string;
  accentColor?: string;
  /** Under the API base: "/branding/logo/acme?v=1a2b3c4d". */
  logoUrl?: string;
}

export interface TenantView {
  id: string;
  name: string;
  status: "active" | "disabled";
  /** Host names of the tenant's site. Changed by the platform operator only. */
  hostnames: string[];
  emailDomains: EmailDomain[];
  branding: BrandingView;
  orgs: { id: number; name: string }[];
}

export interface OrgRow {
  id: number;
  name: string;
  code: string;
  status: "active" | "inactive";
  parentId: number;
  parentName: string;
}

export interface TeamRow {
  id: number;
  name: string;
  email: string;
  status: "active" | "inactive";
  orgId: number;
  orgName: string;
  members: { id: number; name: string }[];
}

/**
 * Free mailbox providers: nobody's organisation, so no tenant may claim them
 * (a claim would put every self-registering Gmail user into one customer).
 */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "zoho.com", "qq.com", "163.com",
]);

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function brandingView(tenant: Pick<Tenant, "id" | "branding">): BrandingView {
  const b = tenant.branding ?? {};
  return {
    ...(b.productName ? { productName: b.productName } : {}),
    ...(b.accentColor ? { accentColor: b.accentColor } : {}),
    ...(b.logo
      ? { logoUrl: `/branding/logo/${tenant.id}?v=${createHash("sha256").update(b.logo).digest("hex").slice(0, 10)}` }
      : {}),
  };
}

/**
 * A customer's own administration, so their administrators never need iTop
 * or the platform operator for day-to-day changes: their organisations,
 * teams, branding and email domains. (Accounts are /api/admin/users, which
 * the tenant guard already holds to the tenant.)
 *
 * Who may manage which tenant:
 * - an administrator bound to a tenant (every customer administrator) only
 *   their own; any other id is a 404, as if it did not exist;
 * - a platform operator on the platform's own address (unscoped) any, and is
 *   the only one who changes a tenant's host names.
 */
export class TenantAdminService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: TenantStore,
    private readonly tenancy: TenantResolver,
  ) {}

  /** The tenants the caller manages: their own, or every one for the platform operator. */
  async list(): Promise<{ operator: boolean; tenants: { id: string; name: string; status: string }[] }> {
    if (!this.tenancy.enabled) return { operator: false, tenants: [] };
    const bound = currentTenant();
    const all = await this.store.list();
    const visible = bound ? all.filter((t) => t.id === bound.id) : all;
    return { operator: !bound, tenants: visible.map((t) => ({ id: t.id, name: t.name, status: t.status })) };
  }

  async get(id: string): Promise<TenantView> {
    const { tenant } = await this.target(id);
    return this.view(tenant);
  }

  async setBranding(id: string, input: TenantBranding): Promise<TenantView> {
    const { tenant } = await this.target(id);
    let branding: TenantBranding;
    try {
      // A part left out stays as it is; an empty string clears it.
      const before = tenant.branding ?? {};
      branding = validateBranding({
        productName: input.productName ?? before.productName,
        accentColor: input.accentColor ?? before.accentColor,
        logo: input.logo ?? before.logo,
      } as TenantBranding);
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    return this.save({ ...tenant, branding });
  }

  async setEmailDomains(id: string, input: EmailDomain[]): Promise<TenantView> {
    const { tenant } = await this.target(id);
    const emailDomains = input.map((d) => ({ domain: normalizeDomain(d.domain.replace(/^@/, "")), orgId: d.orgId }));
    for (const { domain, orgId } of emailDomains) {
      if (!isEmailDomain(domain)) throw badRequest(`"${domain}" is not an email domain, such as acme.com.`);
      if (PUBLIC_MAIL_DOMAINS.has(domain)) throw badRequest(`${domain} is a public mail provider, not an organisation's domain.`);
      if (!tenant.orgIds.includes(orgId)) throw badRequest(`Organisation ${orgId} is not one of ${tenant.name}'s.`);
    }
    return this.save({ ...tenant, emailDomains });
  }

  async setHostnames(id: string, hostnames: string[]): Promise<TenantView> {
    const { tenant, operator } = await this.target(id);
    if (!operator) throw new AppError("forbidden", "Host names are set by the platform operator.");
    const domains = hostnames.map(normalizeDomain).filter(Boolean);
    for (const d of domains) {
      if (!/^[a-z0-9.-]{1,253}$/.test(d) && d !== "localhost") throw badRequest(`"${d}" is not a host name.`);
    }
    return this.save({ ...tenant, domains });
  }

  // ── Organisations ─────────────────────────────────────────────────────

  async orgs(id: string): Promise<OrgRow[]> {
    const { tenant } = await this.target(id);
    return this.orgsOf(tenant);
  }

  /**
   * A new organisation of the tenant. The tenant guard lets only the
   * platform operator add organisations (an Organization is a tenant's
   * boundary), so this is the one place a customer administrator can: the
   * fields are checked here (the parent must be the tenant's), the record is
   * created past the guard, and the organisation joins the tenant at once.
   */
  async createOrg(id: string, input: { name: string; code?: string; parentId?: number }): Promise<OrgRow> {
    const { tenant } = await this.target(id);
    const name = input.name.trim();
    if (!name) throw badRequest("Give the organisation a name.");
    if (input.parentId && !tenant.orgIds.includes(input.parentId)) {
      throw badRequest("The parent organisation must be one of yours.");
    }
    const created = await runUnscoped(() =>
      this.client.call("core/create", {
        class: "Organization",
        fields: {
          name,
          ...(input.code?.trim() ? { code: input.code.trim() } : {}),
          ...(input.parentId ? { parent_id: input.parentId } : {}),
        },
        output_fields: "id",
        comment: `Organisation added by ${currentCaller()?.login ?? "the platform"} for ${tenant.name}`,
      }),
    );
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no organisation.");
    await this.store.save({ ...tenant, orgIds: [...tenant.orgIds, row.id] });
    const fresh = (await this.store.list()).find((t) => t.id === tenant.id) ?? tenant;
    return (await this.orgsOf(fresh, [row.id]))[0]!;
  }

  async updateOrg(id: string, orgId: number, input: { name?: string; code?: string; status?: "active" | "inactive" }): Promise<OrgRow> {
    const { tenant } = await this.target(id);
    if (!tenant.orgIds.includes(orgId)) throw notFound(`No organisation ${orgId} here.`);
    const fields: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw badRequest("An organisation needs a name.");
      fields["name"] = input.name.trim();
    }
    if (input.code !== undefined) fields["code"] = input.code.trim();
    if (input.status) fields["status"] = input.status;
    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");
    await this.client.call("core/update", {
      class: "Organization",
      key: orgId,
      fields,
      output_fields: "id",
      comment: `Organisation updated by ${currentCaller()?.login ?? "the platform"}`,
    });
    return (await this.orgsOf(tenant, [orgId]))[0]!;
  }

  // ── Teams ─────────────────────────────────────────────────────────────

  async teams(id: string): Promise<TeamRow[]> {
    const { tenant } = await this.target(id);
    return this.teamsOf(tenant);
  }

  async createTeam(id: string, input: { name: string; orgId: number; email?: string }): Promise<TeamRow> {
    const { tenant } = await this.target(id);
    if (!input.name.trim()) throw badRequest("Give the team a name.");
    if (!tenant.orgIds.includes(input.orgId)) throw badRequest("The team's organisation must be one of yours.");
    const created = await this.client.call("core/create", {
      class: "Team",
      fields: {
        name: input.name.trim(),
        org_id: input.orgId,
        ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      },
      output_fields: "id",
      comment: `Team added by ${currentCaller()?.login ?? "the platform"}`,
    });
    const row = normalizeObjects(created.objects)[0];
    if (!row) throw new AppError("upstream_error", "iTop reported success but returned no team.");
    return (await this.teamsOf(tenant, row.id))[0]!;
  }

  async updateTeam(
    id: string,
    teamId: number,
    input: { name?: string; email?: string; status?: "active" | "inactive"; memberIds?: number[] },
  ): Promise<TeamRow> {
    const { tenant } = await this.target(id);
    if ((await this.teamsOf(tenant, teamId)).length === 0) throw notFound(`No team ${teamId} here.`);
    const fields: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw badRequest("A team needs a name.");
      fields["name"] = input.name.trim();
    }
    if (input.email !== undefined) fields["email"] = input.email.trim();
    if (input.status) fields["status"] = input.status;
    if (input.memberIds) {
      const ids = [...new Set(input.memberIds)];
      if (ids.length) {
        // Checked here too, so a platform operator (unscoped) cannot put
        // another customer's people in this customer's team either.
        const found = await this.client.call("core/get", {
          class: "Person",
          key: `SELECT Person WHERE id IN (${ids.join(",")}) AND org_id IN (${tenant.orgIds.join(",")})`,
          output_fields: "id",
        });
        if (normalizeObjects(found.objects).length !== ids.length) {
          throw badRequest("Team members must be people of your organisations.");
        }
      }
      // A link set written over REST replaces the whole set: "these are the members now".
      fields["persons_list"] = ids.map((person_id) => ({ person_id }));
    }
    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");
    await this.client.call("core/update", {
      class: "Team",
      key: teamId,
      fields,
      output_fields: "id",
      comment: `Team updated by ${currentCaller()?.login ?? "the platform"}`,
    });
    return (await this.teamsOf(tenant, teamId))[0]!;
  }

  /** People of the tenant, for the team member picker. */
  async people(id: string, q: string | undefined): Promise<{ id: number; name: string; email: string }[]> {
    const { tenant } = await this.target(id);
    if (tenant.orgIds.length === 0) return [];
    const term = q?.trim();
    const match = term
      ? ` AND (name LIKE ${likeContains(term)} OR first_name LIKE ${likeContains(term)} OR email LIKE ${likeContains(term)})`
      : "";
    const result = await this.client.call("core/get", {
      class: "Person",
      key: `SELECT Person WHERE org_id IN (${tenant.orgIds.join(",")})${match}`,
      output_fields: "id,first_name,name,email",
      limit: 25,
    });
    return normalizeObjects(result.objects).map((p) => ({
      id: p.id,
      name: [str(p.fields["first_name"]), str(p.fields["name"])].filter(Boolean).join(" "),
      email: str(p.fields["email"]),
    }));
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async target(id: string): Promise<{ tenant: Tenant; operator: boolean }> {
    if (!this.tenancy.enabled) throw notFound("This platform serves one organisation: there is no customer to manage.");
    const bound = currentTenant();
    const tenant = (await this.store.list()).find((t) => t.id === id);
    if (!tenant || (bound && bound.id !== id)) throw notFound(`No customer "${id}".`);
    return { tenant, operator: !bound };
  }

  private async save(tenant: Tenant): Promise<TenantView> {
    try {
      await this.store.save(tenant);
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    const fresh = (await this.store.list()).find((t) => t.id === tenant.id) ?? tenant;
    return this.view(fresh);
  }

  private async view(tenant: Tenant): Promise<TenantView> {
    const orgs = await this.orgsOf(tenant);
    return {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      hostnames: tenant.domains,
      emailDomains: tenant.emailDomains ?? [],
      branding: brandingView(tenant),
      orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
    };
  }

  /**
   * Reads organisations past the guard: a just-created one is not yet in the
   * request's bound scope. Only ids the tenant owns are ever asked for.
   */
  private async orgsOf(tenant: Tenant, only?: number[]): Promise<OrgRow[]> {
    const ids = (only ?? tenant.orgIds).filter((n) => tenant.orgIds.includes(n));
    if (ids.length === 0) return [];
    const result = await runUnscoped(() =>
      this.client.call("core/get", {
        class: "Organization",
        key: `SELECT Organization WHERE id IN (${ids.join(",")})`,
        output_fields: "id,name,code,status,parent_id,parent_name",
      }),
    );
    return normalizeObjects(result.objects)
      .map((o) => ({
        id: o.id,
        name: str(o.fields["name"]),
        code: str(o.fields["code"]),
        status: str(o.fields["status"]) === "inactive" ? ("inactive" as const) : ("active" as const),
        parentId: Number(o.fields["parent_id"]) || 0,
        parentName: str(o.fields["parent_name"]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async teamsOf(tenant: Tenant, teamId?: number): Promise<TeamRow[]> {
    if (tenant.orgIds.length === 0) return [];
    const result = await this.client.call("core/get", {
      class: "Team",
      key: `SELECT Team WHERE org_id IN (${tenant.orgIds.join(",")})${teamId ? ` AND id = ${teamId}` : ""}`,
      output_fields: "id,name,email,status,org_id,org_name",
    });
    const teams = normalizeObjects(result.objects);
    if (teams.length === 0) return [];
    const links = await this.client.call("core/get", {
      class: "lnkPersonToTeam",
      key: `SELECT lnkPersonToTeam WHERE team_id IN (${teams.map((t) => t.id).join(",")})`,
      output_fields: "team_id,person_id,person_name",
    });
    const members = new Map<number, { id: number; name: string }[]>();
    for (const l of normalizeObjects(links.objects)) {
      const team = Number(l.fields["team_id"]);
      members.set(team, [...(members.get(team) ?? []), { id: Number(l.fields["person_id"]), name: str(l.fields["person_name"]) }]);
    }
    return teams
      .map((t) => ({
        id: t.id,
        name: str(t.fields["name"]),
        email: str(t.fields["email"]),
        status: str(t.fields["status"]) === "inactive" ? ("inactive" as const) : ("active" as const),
        orgId: Number(t.fields["org_id"]) || 0,
        orgName: str(t.fields["org_name"]),
        members: (members.get(t.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

