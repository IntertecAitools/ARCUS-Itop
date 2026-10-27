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

/** `true`/`1` as a query flag; anything else (or absent) is off. */
const flag = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((raw) => raw === true || raw === "true" || raw === "1" || undefined);

/** A calendar day. Whether it is real and not past is TicketExtras' check. */
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const incidentListQuerySchema = z.object({
  page: intParam(1, 100_000, 1),
  limit: intParam(1, 200, 25),
  q: z.string().trim().max(200).optional(),
  status: csvEnum(TICKET_STATUSES),
  priority: csvEnum(TICKET_PRIORITIES),
  // `me`, `unassigned`, or a numeric agent id. Rejected early so a typo
  // cannot be smuggled into the OQL the service builds. The route turns `me`
  // into the caller's contact id before the service sees it.
  assignee: z
    .string()
    .regex(/^(me|unassigned|\d+)$/, "assignee must be 'me', 'unassigned' or a numeric id")
    .optional(),
  sort: z.enum(["ref", "title", "status", "priority", "start_date"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  major: flag,
  overdue: flag,
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
  // An exact instant ("2026-10-20T08:34:00.000Z", what the form sends) or
  // iTop's own wall-clock "YYYY-MM-DD HH:mm[:ss]", read on iTop's clock.
  startDate: z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
      "Use an ISO date-time or YYYY-MM-DD HH:mm",
    )
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
  pendingReason: z.string().trim().max(1_000).optional(),
  nextActionDate: day.optional(),
  comment: z.string().trim().max(10_000).optional(),
});

export const logEntrySchema = z.object({
  message: z.string().trim().min(1, "A message is required").max(10_000),
});

export const majorSchema = z.object({ major: z.boolean() });

export const linkChildrenSchema = z.object({
  incidentIds: z.array(idString).min(1, "Name at least one incident").max(100),
});

export const childParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
  childId: z.string().regex(/^\d+$/, "childId must be numeric"),
});

export const stakeholderUpdateSchema = z.object({
  message: z.string().trim().min(1, "A message is required").max(10_000),
  postToChildren: z.boolean().optional(),
  notifyCallers: z.boolean().optional(),
  notifyEmails: z.array(z.string().trim().email("Not an email address")).max(50).optional(),
});

/** A ticket the hold endpoints accept: the class and its id. */
export const ticketParamSchema = z.object({
  class: z.enum(["Incident", "UserRequest"]),
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});
