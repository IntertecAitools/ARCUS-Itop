import type { FastifyInstance } from "fastify";

import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { formBodySchema, formParams, targetQuery } from "./request-forms.schemas.js";

/**
 * Request forms. Staff read the form for a catalogue item when they raise a
 * request; administrators edit forms under /api/admin (the guard keeps that
 * prefix to the Administrator profile). End users read theirs through
 * /api/portal/request-form, inside the portal's catalogue scope.
 */
export function registerRequestFormRoutes(app: FastifyInstance, services: Services): void {
  const { requestForms } = services;

  app.get("/api/request-forms/resolve", async (request) => {
    const { serviceId, subcategoryId } = parse(targetQuery, request.query, "query parameters");
    return { fields: await requestForms.resolve(serviceId, subcategoryId) };
  });

  app.get("/api/admin/request-forms", async () => requestForms.catalogue());

  app.get("/api/admin/request-forms/:scope/:id", async (request) => {
    const { scope, id } = parse(formParams, request.params, "path parameters");
    return requestForms.get(scope, id);
  });

  app.put("/api/admin/request-forms/:scope/:id", async (request) => {
    const { scope, id } = parse(formParams, request.params, "path parameters");
    const { fields } = parse(formBodySchema, request.body, "request body");
    return requestForms.save(
      scope,
      id,
      fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        ...(f.options ? { options: f.options } : {}),
        ...(f.help !== undefined ? { help: f.help } : {}),
      })),
    );
  });
}
