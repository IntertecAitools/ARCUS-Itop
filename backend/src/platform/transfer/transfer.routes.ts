import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { identifierParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { extractFilters, resolveViewOql } from "../objects/objects.routes.js";
import { parseCriteriaParam } from "../objects/criteria.js";
import { EXPORT_FORMATS, MAX_IMPORT_BYTES } from "./transfer.service.js";

/** Query keys the export interprets itself; anything else is a filter, as on the list. */
const EXPORT_RESERVED = new Set(["format", "q", "view", "oql", "fields", "page", "limit", "sort", "order", "criteria"]);

export function registerTransferRoutes(app: FastifyInstance, services: Services): void {
  /**
   * Download the rows a list shows -- same `view`, `q` and filters -- as CSV,
   * Excel or PDF, rendered by iTop's own exporter.
   */
  app.get("/api/objects/:class/export", async (request, reply) => {
    const { class: className } = parse(z.object({ class: identifierParam }), request.params, "path parameters");
    const query = parse(
      z.object({
        format: z.enum(EXPORT_FORMATS),
        q: z.string().max(200).optional(),
        view: z.string().max(120).regex(/^[A-Za-z0-9_:-]+$/).optional(),
        oql: z.string().max(4_000).optional(),
        fields: z.string().max(2_000).optional(),
        criteria: z.string().max(8_000).optional(),
      }),
      request.query,
      "query parameters",
    );

    const viewOql = await resolveViewOql(services, className, query.view, query.oql);
    const oql = services.objects.queryFor(className, {
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(viewOql !== undefined ? { oql: viewOql } : {}),
      filters: extractFilters(request.query, EXPORT_RESERVED),
      criteria: parseCriteriaParam(query.criteria),
    });

    const file = await services.transfer.export(className, oql, query.format, query.fields);
    return reply
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(Readable.fromWeb(file.body as unknown as NodeReadableStream));
  });

  /**
   * CSV import. `simulate: true` checks every line and writes nothing -- the
   * preview step of iTop's import wizard; send the same body with `false` to
   * load it.
   */
  app.post(
    "/api/objects/:class/import",
    // CSV text travels in JSON, so this route needs more than the 1 MB default.
    { bodyLimit: MAX_IMPORT_BYTES + 64 * 1024 },
    async (request) => {
      const { class: className } = parse(z.object({ class: identifierParam }), request.params, "path parameters");
      const body = parse(
        z.object({
          csv: z.string(),
          simulate: z.boolean().default(true),
          reconciliationKeys: z.array(z.string().regex(/^[A-Za-z0-9_>-]+$/)).max(20).optional(),
          separator: z.string().length(1).optional(),
          qualifier: z.string().length(1).optional(),
          comment: z.string().max(500).optional(),
        }),
        request.body,
        "request body",
      );
      return services.transfer.import(className, {
        csv: body.csv,
        simulate: body.simulate,
        ...(body.reconciliationKeys ? { reconciliationKeys: body.reconciliationKeys } : {}),
        ...(body.separator ? { separator: body.separator } : {}),
        ...(body.qualifier ? { qualifier: body.qualifier } : {}),
        ...(body.comment ? { comment: body.comment } : {}),
      });
    },
  );
}
