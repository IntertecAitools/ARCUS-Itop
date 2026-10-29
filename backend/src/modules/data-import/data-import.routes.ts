import type { FastifyInstance } from "fastify";

import { badRequest } from "../../core/errors.js";
import { parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import {
  classParamSchema,
  idParamSchema,
  importRequestSchema,
  logParamSchema,
  reportParamSchema,
  syncRunSchema,
  syncSourceSchema,
  uploadSchema,
} from "./data-import.schemas.js";
import type { SyncSourceInput } from "./data-import.types.js";
import { MAX_UPLOAD_BYTES, readTable } from "./table.js";

/** Files travel as base64 in JSON (4/3 of their size), rows as JSON arrays. */
const BODY_LIMIT = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 1024 * 1024;

/**
 * Admin data import (a file, mapped, previewed, written through REST) and
 * recurring sync sources (iTop's Data Synchro). Under /api/admin, so the
 * auth guard keeps both to administrators.
 */
export function registerDataImportRoutes(app: FastifyInstance, services: Services): void {
  const { dataImport, syncSources } = services;
  const base = "/api/admin/data-import";
  const sourceInput = (body: unknown) => parse(syncSourceSchema, body, "request body") as SyncSourceInput;

  app.get(`${base}/classes`, async () => ({ classes: dataImport.classes() }));

  /** Reads an uploaded CSV or .xlsx into headings and rows; nothing is kept. */
  app.post(`${base}/read`, { bodyLimit: BODY_LIMIT }, async (request) => {
    const { fileName, content } = parse(uploadSchema, request.body, "request body");
    const bytes = Buffer.from(content, "base64");
    if (bytes.length === 0 && content.length > 0) throw badRequest("The file is not base64.");
    return readTable(fileName, bytes);
  });

  /** The dry run: what the import would do to each row. Writes nothing. */
  app.post(`${base}/:class/preview`, { bodyLimit: BODY_LIMIT }, async (request) => {
    const { class: className } = parse(classParamSchema, request.params, "path parameters");
    return dataImport.plan(className, parse(importRequestSchema, request.body, "request body"));
  });

  app.post(`${base}/:class/run`, { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { class: className } = parse(classParamSchema, request.params, "path parameters");
    const report = await dataImport.run(className, parse(importRequestSchema, request.body, "request body"));
    reply.code(201);
    return report;
  });

  app.get(`${base}/reports`, async () => ({ reports: await dataImport.listReports() }));

  app.get(`${base}/reports/:id`, async (request) => {
    const { id } = parse(reportParamSchema, request.params, "path parameters");
    return dataImport.report(id);
  });

  app.get(`${base}/reports/:id/download`, async (request, reply) => {
    const { id } = parse(reportParamSchema, request.params, "path parameters");
    const file = await dataImport.reportCsv(id);
    return reply
      .header("Content-Type", "text/csv;charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(file.csv);
  });

  // Sync sources ------------------------------------------------------------

  app.get(`${base}/sync-sources`, async () => ({ sources: await syncSources.list() }));

  app.post(`${base}/sync-sources`, async (request, reply) => {
    const created = await syncSources.create(sourceInput(request.body));
    reply.code(201);
    return created;
  });

  app.get(`${base}/sync-sources/:id`, async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    return syncSources.get(id);
  });

  app.put(`${base}/sync-sources/:id`, async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    return syncSources.update(id, sourceInput(request.body));
  });

  app.delete(`${base}/sync-sources/:id`, async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    await syncSources.remove(id);
    return { ok: true };
  });

  app.get(`${base}/sync-sources/:id/logs/:logId`, async (request) => {
    const { id, logId } = parse(logParamSchema, request.params, "path parameters");
    return syncSources.log(id, logId);
  });

  /** Loads a file into the source and synchronizes; `simulate` rolls it back. */
  app.post(`${base}/sync-sources/:id/run`, { bodyLimit: BODY_LIMIT }, async (request) => {
    const { id } = parse(idParamSchema, request.params, "path parameters");
    return syncSources.run(id, parse(syncRunSchema, request.body, "request body"));
  });
}
