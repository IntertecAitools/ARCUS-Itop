import { badRequest, notFound } from "../../core/errors.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import { oqlString, str } from "../../shared/ticket-mapping.js";
import type {
  CreateOrganizationInput,
  CreatePersonInput,
  CreateTeamInput,
  DirectoryListQuery,
  DirectoryListResult,
  DirectoryOptions,
  OrganizationDto,
  PersonDto,
  RecordStatus,
  TeamDto,
  UpdateOrganizationInput,
  UpdatePersonInput,
  UpdateTeamInput,
} from "./directory.types.js";

const ORG_FIELDS = "id,name,code,status,parent_id,parent_name";
const PERSON_FIELDS =
  "id,first_name,name,email,phone,mobile_phone,function,employee_number,status,org_id,org_name,manager_id,manager_name";
const TEAM_FIELDS = "id,name,email,phone,function,status,org_id,org_name";

const optional = (value: unknown) => str(value) || undefined;

/** Builds a {id,name} only when iTop actually holds a link (0 = none). */
function link(fields: Record<string, unknown>, idKey: string, nameKey: string) {
  const id = str(fields[idKey]);
  return id && id !== "0" ? { id, name: str(fields[nameKey]) } : undefined;
}

/**
 * Organisations, people and teams — the records that must exist before a
 * ticket can.
 *
 * iTop requires an `org_id` on every Person, Team and Incident, so a brand new
 * instance cannot raise a ticket until a company is onboarded. This module is
 * what makes that possible from our own UI instead of iTop's console.
 *
 * All three share one service because they share one shape: a flat record with
 * a name, a status and an organisation. Splitting them into three services
 * would triplicate the list/filter/paging code for no gain.
 */
export class DirectoryService {
  constructor(private readonly objects: ObjectsService) {}

  /* --------------------------------------------------------------------- *
   * Shared querying
   * --------------------------------------------------------------------- */

  /**
   * Returns `null` when a filter can match nothing, so the caller returns an
   * empty page rather than issuing a query whose WHERE clause is dropped —
   * which would return every row, the opposite of what was asked.
   */
  private where(query: DirectoryListQuery, searchFields: string[]): string | null {
    const clauses: string[] = [];

    if (query.status) clauses.push(`status = '${query.status}'`);

    if (query.organizationId) {
      if (!/^\d+$/.test(query.organizationId)) return null;
      clauses.push(`org_id = ${query.organizationId}`);
    }

    if (query.q) {
      const term = oqlString(query.q);
      clauses.push(`(${searchFields.map((f) => `${f} LIKE '%${term}%'`).join(" OR ")})`);
    }

    return clauses.length ? clauses.join(" AND ") : "1=1";
  }

  private async list<T>(
    className: string,
    query: DirectoryListQuery,
    fields: string,
    searchFields: string[],
    map: (item: ObjectDto) => T,
  ): Promise<DirectoryListResult<T>> {
    const where = this.where(query, searchFields);
    if (where === null) {
      return { items: [], page: query.page, limit: query.limit, total: 0, pages: 0, hasMore: false };
    }

    const result = await this.objects.list(className, {
      page: query.page,
      limit: query.limit,
      oql: `SELECT ${className} WHERE ${where}`,
      fields,
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.order ? { order: query.order } : {}),
    });

    return {
      items: result.items.map(map),
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: result.pages,
      hasMore: result.hasMore,
    };
  }

  private async one(className: string, id: string, fields: string): Promise<ObjectDto> {
    const result = await this.objects.list(className, {
      page: 1,
      limit: 1,
      oql: `SELECT ${className} WHERE id = ${id}`,
      fields,
    });
    const item = result.items[0];
    if (!item) throw notFound(`${className} ${id} was not found.`);
    return item;
  }

  /** Cheap count: ask for one row and read the "Found: N" total. */
  private async count(className: string, where: string): Promise<number> {
    const result = await this.objects.list(className, {
      page: 1,
      limit: 1,
      oql: `SELECT ${className} WHERE ${where}`,
      fields: "id",
    });
    return result.total;
  }

  /* --------------------------------------------------------------------- *
   * Organisations
   * --------------------------------------------------------------------- */

  private toOrganization(item: ObjectDto): OrganizationDto {
    const f = item.fields;
    return {
      id: String(item.id),
      name: str(f["name"]),
      code: optional(f["code"]),
      status: (str(f["status"]) || "active") as RecordStatus,
      parent: link(f, "parent_id", "parent_name"),
    };
  }

  listOrganizations(query: DirectoryListQuery) {
    return this.list("Organization", query, ORG_FIELDS, ["name", "code"], (i) =>
      this.toOrganization(i),
    );
  }

  async getOrganization(id: string): Promise<OrganizationDto> {
    const item = await this.one("Organization", id, ORG_FIELDS);
    const [people, teams] = await Promise.all([
      this.count("Person", `org_id = ${id}`),
      this.count("Team", `org_id = ${id}`),
    ]);
    return { ...this.toOrganization(item), counts: { people, teams } };
  }

  async createOrganization(input: CreateOrganizationInput): Promise<OrganizationDto> {
    const fields: Record<string, unknown> = {
      name: input.name,
      status: input.status ?? "active",
    };
    if (input.code) fields["code"] = input.code;
    if (input.parentId) fields["parent_id"] = Number(input.parentId);

    const { object } = await this.objects.create("Organization", fields, {
      fields: ORG_FIELDS,
      comment: "Organisation created via ARCUS",
    });
    return this.toOrganization(object);
  }

  async updateOrganization(id: string, input: UpdateOrganizationInput): Promise<OrganizationDto> {
    const fields: Record<string, unknown> = {};
    if (input.name !== undefined) fields["name"] = input.name;
    if (input.code !== undefined) fields["code"] = input.code;
    if (input.status !== undefined) fields["status"] = input.status;
    // `null` clears the link, which iTop expresses as 0. Omitting the key means
    // "leave unchanged", so the two cases must stay distinct.
    if (input.parentId !== undefined) {
      fields["parent_id"] = input.parentId ? Number(input.parentId) : 0;
    }

    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");

    const { object } = await this.objects.update("Organization", Number(id), fields, {
      fields: ORG_FIELDS,
      comment: "Organisation updated via ARCUS",
    });
    return this.toOrganization(object);
  }

  /* --------------------------------------------------------------------- *
   * People
   * --------------------------------------------------------------------- */

  private toPerson(item: ObjectDto): PersonDto {
    const f = item.fields;
    // iTop stores the surname in `name` and the given name in `first_name`.
    const firstName = str(f["first_name"]);
    const lastName = str(f["name"]);
    return {
      id: String(item.id),
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" ") || `#${item.id}`,
      email: optional(f["email"]),
      phone: optional(f["phone"]),
      mobile: optional(f["mobile_phone"]),
      function: optional(f["function"]),
      employeeNumber: optional(f["employee_number"]),
      status: (str(f["status"]) || "active") as RecordStatus,
      organization: link(f, "org_id", "org_name") ?? { id: "", name: "" },
      manager: link(f, "manager_id", "manager_name"),
    };
  }

  listPeople(query: DirectoryListQuery) {
    return this.list("Person", query, PERSON_FIELDS, ["name", "first_name", "email"], (i) =>
      this.toPerson(i),
    );
  }

  async getPerson(id: string): Promise<PersonDto> {
    const item = await this.one("Person", id, PERSON_FIELDS);
    const person = this.toPerson(item);

    // Team membership lives on a link class, so it needs its own query.
    const links = await this.objects.list("lnkPersonToTeam", {
      page: 1,
      limit: 100,
      oql: `SELECT lnkPersonToTeam WHERE person_id = ${id}`,
      fields: "id,team_id,team_name,role_id,role_name",
    });

    return {
      ...person,
      teams: links.items.map((l) => ({
        id: str(l.fields["team_id"]),
        name: str(l.fields["team_name"]),
        role: optional(l.fields["role_name"]),
      })),
    };
  }

  async createPerson(input: CreatePersonInput): Promise<PersonDto> {
    const fields: Record<string, unknown> = {
      first_name: input.firstName,
      name: input.lastName,
      org_id: Number(input.organizationId),
      status: input.status ?? "active",
    };
    if (input.email) fields["email"] = input.email;
    if (input.phone) fields["phone"] = input.phone;
    if (input.mobile) fields["mobile_phone"] = input.mobile;
    if (input.function) fields["function"] = input.function;
    if (input.employeeNumber) fields["employee_number"] = input.employeeNumber;
    if (input.managerId) fields["manager_id"] = Number(input.managerId);

    const { object } = await this.objects.create("Person", fields, {
      fields: PERSON_FIELDS,
      comment: "Person created via ARCUS",
    });
    return this.toPerson(object);
  }

  async updatePerson(id: string, input: UpdatePersonInput): Promise<PersonDto> {
    const fields: Record<string, unknown> = {};
    if (input.firstName !== undefined) fields["first_name"] = input.firstName;
    if (input.lastName !== undefined) fields["name"] = input.lastName;
    if (input.organizationId !== undefined) fields["org_id"] = Number(input.organizationId);
    if (input.email !== undefined) fields["email"] = input.email;
    if (input.phone !== undefined) fields["phone"] = input.phone;
    if (input.mobile !== undefined) fields["mobile_phone"] = input.mobile;
    if (input.function !== undefined) fields["function"] = input.function;
    if (input.employeeNumber !== undefined) fields["employee_number"] = input.employeeNumber;
    if (input.status !== undefined) fields["status"] = input.status;
    if (input.managerId !== undefined) {
      fields["manager_id"] = input.managerId ? Number(input.managerId) : 0;
    }

    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");

    const { object } = await this.objects.update("Person", Number(id), fields, {
      fields: PERSON_FIELDS,
      comment: "Person updated via ARCUS",
    });
    return this.toPerson(object);
  }

  /* --------------------------------------------------------------------- *
   * Teams
   * --------------------------------------------------------------------- */

  private toTeam(item: ObjectDto): TeamDto {
    const f = item.fields;
    return {
      id: String(item.id),
      name: str(f["name"]),
      email: optional(f["email"]),
      phone: optional(f["phone"]),
      function: optional(f["function"]),
      status: (str(f["status"]) || "active") as RecordStatus,
      organization: link(f, "org_id", "org_name") ?? { id: "", name: "" },
    };
  }

  listTeams(query: DirectoryListQuery) {
    return this.list("Team", query, TEAM_FIELDS, ["name", "email"], (i) => this.toTeam(i));
  }

  async getTeam(id: string): Promise<TeamDto> {
    const item = await this.one("Team", id, TEAM_FIELDS);
    const links = await this.objects.list("lnkPersonToTeam", {
      page: 1,
      limit: 200,
      oql: `SELECT lnkPersonToTeam WHERE team_id = ${id}`,
      fields: "id,person_id,person_name,role_id,role_name",
    });

    const members = links.items.map((l) => ({
      id: str(l.fields["person_id"]),
      name: str(l.fields["person_name"]),
      role: optional(l.fields["role_name"]),
    }));

    return { ...this.toTeam(item), members, memberCount: members.length };
  }

  async createTeam(input: CreateTeamInput): Promise<TeamDto> {
    const fields: Record<string, unknown> = {
      name: input.name,
      org_id: Number(input.organizationId),
      status: input.status ?? "active",
    };
    if (input.email) fields["email"] = input.email;
    if (input.phone) fields["phone"] = input.phone;
    if (input.function) fields["function"] = input.function;

    const { object } = await this.objects.create("Team", fields, {
      fields: TEAM_FIELDS,
      comment: "Team created via ARCUS",
    });
    return this.toTeam(object);
  }

  async updateTeam(id: string, input: UpdateTeamInput): Promise<TeamDto> {
    const fields: Record<string, unknown> = {};
    if (input.name !== undefined) fields["name"] = input.name;
    if (input.organizationId !== undefined) fields["org_id"] = Number(input.organizationId);
    if (input.email !== undefined) fields["email"] = input.email;
    if (input.phone !== undefined) fields["phone"] = input.phone;
    if (input.function !== undefined) fields["function"] = input.function;
    if (input.status !== undefined) fields["status"] = input.status;

    if (Object.keys(fields).length === 0) throw badRequest("No changes were supplied.");

    const { object } = await this.objects.update("Team", Number(id), fields, {
      fields: TEAM_FIELDS,
      comment: "Team updated via ARCUS",
    });
    return this.toTeam(object);
  }

  /* --------------------------------------------------------------------- *
   * Membership
   * --------------------------------------------------------------------- */

  /** Adds a person to a team. Idempotent: re-adding is a no-op, not an error. */
  async addTeamMember(teamId: string, personId: string): Promise<TeamDto> {
    const existing = await this.objects.list("lnkPersonToTeam", {
      page: 1,
      limit: 1,
      oql: `SELECT lnkPersonToTeam WHERE team_id = ${teamId} AND person_id = ${personId}`,
      fields: "id",
    });

    if (existing.total === 0) {
      await this.objects.create(
        "lnkPersonToTeam",
        { team_id: Number(teamId), person_id: Number(personId) },
        { fields: "id", comment: "Team member added via ARCUS" },
      );
    }

    return this.getTeam(teamId);
  }

  async removeTeamMember(teamId: string, personId: string): Promise<TeamDto> {
    const existing = await this.objects.list("lnkPersonToTeam", {
      page: 1,
      limit: 1,
      oql: `SELECT lnkPersonToTeam WHERE team_id = ${teamId} AND person_id = ${personId}`,
      fields: "id",
    });

    const linkId = existing.items[0]?.id;
    if (linkId === undefined) throw notFound(`Person ${personId} is not in team ${teamId}.`);

    await this.objects.remove("lnkPersonToTeam", Number(linkId), {
      comment: "Team member removed via ARCUS",
    });
    return this.getTeam(teamId);
  }

  /* --------------------------------------------------------------------- *
   * Form options
   * --------------------------------------------------------------------- */

  async formOptions(): Promise<DirectoryOptions> {
    const pick = async (className: string, label: (f: Record<string, unknown>) => string) => {
      try {
        const result = await this.objects.list(className, {
          page: 1,
          limit: 200,
          oql: `SELECT ${className}`,
          fields: className === "Person" ? "id,first_name,name" : "id,name",
        });
        return result.items.map((item) => ({
          value: String(item.id),
          label: label(item.fields) || item.label || `#${item.id}`,
        }));
      } catch {
        // A class this instance lacks must not take the whole form down.
        return [];
      }
    };

    const [organizations, people, teams] = await Promise.all([
      pick("Organization", (f) => str(f["name"])),
      pick("Person", (f) => [str(f["first_name"]), str(f["name"])].filter(Boolean).join(" ")),
      pick("Team", (f) => str(f["name"])),
    ]);

    return {
      organizations,
      people,
      teams,
      statuses: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    };
  }
}
