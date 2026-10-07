import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { identifierParam, intParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";

const RESERVED = new Set(["q", "limit"]);

export function registerLookupRoutes(app: FastifyInstance, services: Services): void {
  const { lookups } = services;

  const optionQuerySchema = z.object({
    q: z.string().max(200).optional(),
    limit: intParam(1, 500, 100),
  });

  /** Every option of a class, for a standalone dropdown. */
  app.get("/api/lookups/:class", async (request) => {
    const params = parse(z.object({ class: identifierParam }), request.params, "path parameters");
    const query = parse(optionQuerySchema, request.query, "query parameters");

    return lookups.forClass(params.class, {
      ...(query.q !== undefined ? { q: query.q } : {}),
      limit: query.limit,
    });
  });

  /**
   * Options valid for one picker on one class, honouring the datamodel's filter.
   *
   * Dependent pickers need the current form values. Pass them as plain query
   * params, e.g. for Server.model_id whose filter is
   * "SELECT Model WHERE brand_id=:this->brand_id AND type=:this->finalclass":
   *
   *   /api/meta/classes/Server/fields/model_id/options?brand_id=3
   *
   * The response reports `filterIgnored` when the filter could not be applied,
   * so the UI can keep the dropdown disabled rather than show wrong options.
   */
  app.get("/api/meta/classes/:class/fields/:attcode/options", async (request) => {
    const params = parse(
      z.object({ class: identifierParam, attcode: identifierParam }),
      request.params,
      "path parameters",
    );
    const query = parse(optionQuerySchema, request.query, "query parameters");

    const context: Record<string, string> = {};
    if (typeof request.query === "object" && request.query !== null) {
      for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
        if (RESERVED.has(key)) continue;
        const single = Array.isArray(value) ? value[0] : value;
        if (typeof single === "string" || typeof single === "number") {
          context[key] = String(single);
        }
      }
    }

    return lookups.forField(params.class, params.attcode, {
      ...(query.q !== undefined ? { q: query.q } : {}),
      limit: query.limit,
      context,
    });
  });
}
