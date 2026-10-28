import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  assignmentSchema,
  calendarSchema,
  coverageWindowSchema,
  holidaySchema,
  idParamSchema,
} from "./business-hours.schemas.js";
import type { OpenInterval } from "./business-hours.types.js";

/**
 * Business hours (coverage windows), holidays and which window each
 * customer contract's service runs in. Under /api/admin, so the auth guard
 * keeps it to administrators.
 */
export function registerBusinessHoursRoutes(app: FastifyInstance, services: Services): void {
  const { businessHours } = services;
  const base = "/api/admin/business-hours";
  const id = (params: unknown) => parse(idParamSchema, params, "path parameters").id;
  const window = (body: unknown) => {
    const input = parse(coverageWindowSchema, body, "request body");
    return { ...input, intervals: input.intervals as OpenInterval[] };
  };

  app.get(base, async () => businessHours.overview());

  app.post(`${base}/coverage-windows`, async (request, reply) => {
    const created = await businessHours.createWindow(window(request.body));
    reply.code(201);
    return created;
  });
  app.put(`${base}/coverage-windows/:id`, async (request) => {
    await businessHours.updateWindow(id(request.params), window(request.body));
    return { ok: true };
  });
  app.delete(`${base}/coverage-windows/:id`, async (request) => businessHours.deleteWindow(id(request.params)));

  app.post(`${base}/calendars`, async (request, reply) => {
    const created = await businessHours.createCalendar(parse(calendarSchema, request.body, "request body"));
    reply.code(201);
    return created;
  });
  app.put(`${base}/calendars/:id`, async (request) => {
    await businessHours.updateCalendar(id(request.params), parse(calendarSchema, request.body, "request body"));
    return { ok: true };
  });
  app.delete(`${base}/calendars/:id`, async (request) => {
    await businessHours.deleteCalendar(id(request.params));
    return { ok: true };
  });

  app.post(`${base}/holidays`, async (request, reply) => {
    const created = await businessHours.createHoliday(parse(holidaySchema, request.body, "request body"));
    reply.code(201);
    return created;
  });
  app.put(`${base}/holidays/:id`, async (request) => {
    await businessHours.updateHoliday(id(request.params), parse(holidaySchema, request.body, "request body"));
    return { ok: true };
  });
  app.delete(`${base}/holidays/:id`, async (request) => {
    await businessHours.deleteHoliday(id(request.params));
    return { ok: true };
  });

  app.put(`${base}/assignments/:id`, async (request) => {
    await businessHours.assign(id(request.params), parse(assignmentSchema, request.body, "request body"));
    return { ok: true };
  });
}
