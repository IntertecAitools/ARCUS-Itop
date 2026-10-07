import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  addMemberSchema,
  createOrganizationSchema,
  createPersonSchema,
  createTeamSchema,
  directoryListQuerySchema,
  idParamSchema,
  memberParamSchema,
  updateOrganizationSchema,
  updatePersonSchema,
  updateTeamSchema,
} from "./directory.schemas.js";
import type {
  CreateOrganizationInput,
  CreatePersonInput,
  CreateTeamInput,
  UpdateOrganizationInput,
  UpdatePersonInput,
  UpdateTeamInput,
} from "./directory.types.js";

/**
 * HTTP surface for the directory: organisations, people and teams.
 *
 * Routes validate and map to status codes; they make no decisions.
 */
export function registerDirectoryRoutes(app: FastifyInstance, services: Services): void {
  const { directory } = services;

  /**
   * Shared pickers. Declared before `/:id` on each collection would be wrong
   * here because it sits on its own path, but the ordering rule still applies
   * to every static segment below.
   */
  app.get("/api/directory/options", async () => directory.formOptions());

  /* ---------------------------------------------------------------- orgs */

  app.get("/api/organizations", async (request) => {
    const query = parse(directoryListQuerySchema, request.query, "query parameters");
    return directory.listOrganizations(query);
  });

  app.get("/api/organizations/:id", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    return directory.getOrganization(id);
  });

  app.post("/api/organizations", async (request, reply) => {
    const body = parse(createOrganizationSchema, request.body, "request body");
    const created = await directory.createOrganization(body as CreateOrganizationInput);
    reply.code(201).header("location", `/api/organizations/${created.id}`);
    return created;
  });

  app.patch("/api/organizations/:id", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    const body = parse(updateOrganizationSchema, request.body, "request body");
    return directory.updateOrganization(id, body as UpdateOrganizationInput);
  });

  /* -------------------------------------------------------------- people */

  app.get("/api/people", async (request) => {
    const query = parse(directoryListQuerySchema, request.query, "query parameters");
    return directory.listPeople(query);
  });

  app.get("/api/people/:id", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    return directory.getPerson(id);
  });

  app.post("/api/people", async (request, reply) => {
    const body = parse(createPersonSchema, request.body, "request body");
    const created = await directory.createPerson(body as CreatePersonInput);
    reply.code(201).header("location", `/api/people/${created.id}`);
    return created;
  });

  app.patch("/api/people/:id", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    const body = parse(updatePersonSchema, request.body, "request body");
    return directory.updatePerson(id, body as UpdatePersonInput);
  });

  /* --------------------------------------------------------------- teams */

  app.get("/api/teams", async (request) => {
    const query = parse(directoryListQuerySchema, request.query, "query parameters");
    return directory.listTeams(query);
  });

  app.get("/api/teams/:id", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    return directory.getTeam(id);
  });

  app.post("/api/teams", async (request, reply) => {
    const body = parse(createTeamSchema, request.body, "request body");
    const created = await directory.createTeam(body as CreateTeamInput);
    reply.code(201).header("location", `/api/teams/${created.id}`);
    return created;
  });

  app.patch("/api/teams/:id", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    const body = parse(updateTeamSchema, request.body, "request body");
    return directory.updateTeam(id, body as UpdateTeamInput);
  });

  app.post("/api/teams/:id/members", async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    const { personId } = parse(addMemberSchema, request.body, "request body");
    return directory.addTeamMember(id, personId);
  });

  app.delete("/api/teams/:id/members/:personId", async (request) => {
    const { id, personId } = parse(memberParamSchema, request.params, "path parameters");
    return directory.removeTeamMember(id, personId);
  });
}
