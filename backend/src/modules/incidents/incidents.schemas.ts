import { z } from "zod";

import { intParam } from "../../core/validate.js";
import { ORIGINS, RESOLUTION_CODES, TRANSITION_ACTIONS } from "../../shared/ticket-mapping.js";

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

/** iTop's numeric enums, as strings. */
const LEVEL_1_4 = ["1", "2", "3", "4"] as const;
const LEVEL_1_3 = ["1", "2", "3"] as const;

/** A numeric id as a string. */
const idString = z.string().regex(/^\d+$/, "must be a numeric id");

/** A numeric id, or null/"" to clear the link. */
const nullableId = z.union([idString, z.literal(""), z.null()]).optional();

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

export const createIncidentSchema = z.object({
  // iTop requires title, description and an organisation; rejecting here gives
  // a field-level message instead of a generic upstream failure.
  title: z.string().trim().min(1, "A title is required").max(255),
  description: z.string().trim().min(1, "A description is required").max(10_000),
  // Optional: omitted by the UI, resolved server-side.
  organizationId: idString.optional(),
  callerId: idString.optional(),
  // No `priority`: iTop derives it from urgency x impact and ignores an
  // explicit value, so accepting one would quietly mislead the caller.
  urgency: z.enum(LEVEL_1_4).optional(),
  impact: z.enum(LEVEL_1_3).optional(),
  origin: z.enum(ORIGINS).optional(),
  serviceId: idString.optional(),
  serviceSubcategoryId: idString.optional(),
  agentId: idString.optional(),
  teamId: idString.optional(),
  // Accepts an <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm") as
  // well as iTop's own "YYYY-MM-DD HH:mm:ss"; the service normalises.
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, "Use YYYY-MM-DD HH:mm")
    .optional(),
});

export const updateIncidentSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).max(10_000).optional(),
    urgency: z.enum(LEVEL_1_4).optional(),
    impact: z.enum(LEVEL_1_3).optional(),
    agentId: nullableId,
    teamId: nullableId,
    serviceId: nullableId,
    serviceSubcategoryId: nullableId,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Supply at least one field to update.",
  });

export const transitionSchema = z.object({
  action: z.enum(TRANSITION_ACTIONS as [string, ...string[]]),
  agentId: idString.optional(),
  solution: z.string().trim().min(1).max(10_000).optional(),
  resolutionCode: z.enum(RESOLUTION_CODES).optional(),
  pendingReason: z.string().trim().max(500).optional(),
  comment: z.string().trim().max(10_000).optional(),
});

export const logEntrySchema = z.object({
  message: z.string().trim().min(1, "A message is required").max(10_000),
});
