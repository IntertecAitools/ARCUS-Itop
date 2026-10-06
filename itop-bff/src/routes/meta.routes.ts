import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Services } from "../services/index.js";
import { identifierParam, parse } from "../http/validate.js";

/**
 * Schema endpoints. A schema-driven frontend calls these once at boot and then
 * renders generically, so everything it needs to lay out a form is here:
 * categories, widgets, enum values, picker targets, and dependency hints.
 */
export function registerMetaRoutes(app: FastifyInstance, services: Services): void {
  const { schema, client } = services;

  app.get("/api/meta/classes", async () => ({
    classes: schema.list().map((info) => ({
      name: info.name,
      isCi: info.isCi,
      abstract: info.abstract,
      parent: info.parent,
      inherits: info.inherits,
      hasLifecycle: info.lifecycle !== null,
      counts: {
        writable: info.writable.length,
        readonly: info.readonlyFields.length,
        related: info.relatedFields.length,
        pickers: info.pickerFields.length,
      },
    })),
    groups: {
      ci: schema.ciClasses().map((c) => c.name),
      abstract: schema
        .list()
        .filter((c) => c.abstract)
        .map((c) => c.name),
      lookup: schema.lookupClasses().map((c) => c.name),
    },
  }));

  app.get("/api/meta/classes/:class", async (request) => {
    const params = parse(z.object({ class: identifierParam }), request.params, "path parameters");
    const info = schema.require(params.class);
    return {
      name: info.name,
      isCi: info.isCi,
      abstract: info.abstract,
      parent: info.parent,
      inherits: info.inherits,
      lifecycle: info.lifecycle,
      writable: info.writable,
      readonly: info.readonlyFields,
      related: info.relatedFields,
      pickers: info.pickerFields,
      searchable: info.searchable,
      fields: info.fields,
    };
  });

  /**
   * Problems found while loading the compiled schema: re-categorised attributes
   * and picker targets that are missing from the export. Worth checking after
   * every re-run of extract-schema.py.
   */
  app.get("/api/meta/diagnostics", async () => ({
    count: schema.diagnostics.length,
    diagnostics: schema.diagnostics,
  }));

  /** Verbs this iTop build actually exposes, straight from list_operations. */
  app.get("/api/meta/operations", async () => ({
    operations: await client.listOperations(),
  }));
}
