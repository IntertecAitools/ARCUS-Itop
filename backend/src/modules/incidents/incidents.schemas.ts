import { z } from "zod";

import { intParam } from "../../core/validate.js";

/**
 * Request validation for the incidents module.
 *
 * Filters arrive as repeated or comma-separated query params
 * (`?status=open&status=pending` or `?status=open,pending`); both normalise to
 * an array here so the service only ever sees one shape.
 */

const TICKET_STATUSES = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
] as const;

const TICKET_PRIORITIES = ["critical", "high", "medium", "low"] as const;

/** Accepts `a`, `a,b`, or `["a","b"]` and yields a de-duplicated array. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const parts = (Array.isArray(raw) ? raw : [raw])
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean);
      return parts.length ? [...new Set(parts)] : undefined;
    })
    .pipe(z.array(z.enum(values)).optional());

export const incidentListQuerySchema = z.object({
  page: intParam(1, 100_000, 1),
  limit: intParam(1, 200, 25),
  q: z.string().trim().max(200).optional(),
  status: csvEnum(TICKET_STATUSES),
  priority: csvEnum(TICKET_PRIORITIES),
  // `unassigned`, or a numeric agent id. Rejected early so a typo cannot be
  // smuggled into the OQL the service builds.
  assignee: z
    .string()
    .regex(/^(unassigned|\d+)$/, "assignee must be 'unassigned' or a numeric id")
    .optional(),
  sort: z.enum(["ref", "title", "status", "priority", "start_date"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const incidentIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});
