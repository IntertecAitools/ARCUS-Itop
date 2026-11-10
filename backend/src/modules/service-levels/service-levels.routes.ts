import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  contractSchema,
  contractServiceSchema,
  contractServiceUpdateSchema,
  idParamSchema,
  slaSchema,
  targetSchema,
} from "./service-levels.schemas.js";

/**
 * SLA targets, SLAs and customer contracts with the SLA each service runs
 * under. Under /api/admin, so the auth guard keeps it to administrators.
 */
export function registerServiceLevelRoutes(app: FastifyInstance, services: Services): void {
  const { serviceLevels } = services;
  const base = "/api/admin/service-levels";
  const id = (params: unknown) => parse(idParamSchema, params, "path parameters").id;

  app.get(base, async () => serviceLevels.overview());

  app.post(`${base}/targets`, async (request, reply) => {
    const created = await serviceLevels.createTarget(parse(targetSchema, request.body, "request body"));
    reply.code(201);
    return created;
  });
  app.put(`${base}/targets/:id`, async (request) => {
    await serviceLevels.updateTarget(id(request.params), parse(targetSchema, request.body, "request body"));
    return { ok: true };
  });
  app.delete(`${base}/targets/:id`, async (request) => {
    await serviceLevels.deleteTarget(id(request.params));
    return { ok: true };
  });

  app.post(`${base}/slas`, async (request, reply) => {
    const created = await serviceLevels.createSla(parse(slaSchema, request.body, "request body"));
    reply.code(201);
    return created;
  });
  app.put(`${base}/slas/:id`, async (request) => {
    await serviceLevels.updateSla(id(request.params), parse(slaSchema, request.body, "request body"));
    return { ok: true };
  });
  app.delete(`${base}/slas/:id`, async (request) => serviceLevels.deleteSla(id(request.params)));

  app.post(`${base}/contracts`, async (request, reply) => {
    const created = await serviceLevels.createContract(parse(contractSchema, request.body, "request body"));
    reply.code(201);
    return created;
  });
  app.put(`${base}/contracts/:id`, async (request) => {
    await serviceLevels.updateContract(id(request.params), parse(contractSchema, request.body, "request body"));
    return { ok: true };
  });
  app.delete(`${base}/contracts/:id`, async (request) => {
    await serviceLevels.deleteContract(id(request.params));
    return { ok: true };
  });

  app.post(`${base}/contracts/:id/services`, async (request, reply) => {
    const created = await serviceLevels.addContractService(id(request.params), parse(contractServiceSchema, request.body, "request body"));
    reply.code(201);
    return created;
  });
  app.put(`${base}/contract-services/:id`, async (request) => {
    const { slaId } = parse(contractServiceUpdateSchema, request.body, "request body");
    await serviceLevels.setContractServiceSla(id(request.params), slaId);
    return { ok: true };
  });
  app.delete(`${base}/contract-services/:id`, async (request) => {
    await serviceLevels.removeContractService(id(request.params));
    return { ok: true };
  });
}
