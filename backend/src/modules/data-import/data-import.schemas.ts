import { z } from "zod";

import { MAX_UPLOAD_BYTES } from "./table.js";

const target = z.string().max(128).regex(/^[A-Za-z_][A-Za-z0-9_]*(->[A-Za-z_][A-Za-z0-9_]*)?$/);
const cell = z.string().max(65_535);
const rows = z.array(z.array(cell).max(500)).max(20_000);

export const uploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  /** The file, base64-encoded. */
  content: z.string().max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 16),
});

export const classParamSchema = z.object({ class: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(64) });
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const reportParamSchema = z.object({ id: z.string().uuid() });
export const logParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  logId: z.coerce.number().int().positive(),
});

export const importRequestSchema = z.object({
  fileName: z.string().max(255).optional(),
  columns: z.array(target.nullable()).min(1).max(500),
  rows,
  keys: z.array(target).max(10),
  comment: z.string().max(500).optional(),
});

const attcode = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(64);

export const syncSourceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2_000).optional(),
  status: z.enum(["implementation", "production", "obsolete"]).optional(),
  targetClass: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(64),
  reconciliationPolicy: z.enum(["use_attributes", "use_primary_key"]).optional(),
  keys: z.array(attcode).max(20),
  columns: z.array(attcode).min(1).max(200),
  lookups: z.record(attcode, z.union([attcode, z.literal("")])).optional(),
  actionOnZero: z.enum(["create", "error"]).optional(),
  actionOnOne: z.enum(["update", "error"]).optional(),
  actionOnMultiple: z.enum(["take_first", "create", "error"]).optional(),
  deletePolicy: z.enum(["ignore", "delete", "update", "update_then_delete"]).optional(),
  deletePolicyUpdate: z.string().max(255).regex(/^[^\n\r]*$/).optional(),
  deletePolicyRetention: z.number().int().min(0).max(10 * 365 * 86_400).optional(),
  fullLoadPeriodicity: z.number().int().min(0).max(365 * 86_400).optional(),
});

export const syncRunSchema = z.object({
  columns: z.array(z.union([attcode, z.null()])).min(1).max(500),
  rows,
  simulate: z.boolean().default(true),
});
