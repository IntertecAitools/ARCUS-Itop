import { z } from "zod";

import { idParam, intParam } from "../../core/validate.js";

const handledClass = z.enum(["Incident", "UserRequest"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const ticketParams = z.object({ class: handledClass, id: idParam });
export const entryParams = z.object({ entryId: idParam });
export const draftParams = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/, "must be a draft id") });

export const overrideSchema = z.object({
  priority: z.enum(["critical", "high", "medium", "low"]),
  reason: z.string().max(2_000),
});

export const markDuplicateSchema = z.object({
  originalClass: handledClass,
  originalId: z.number().int().positive(),
  note: z.string().max(2_000).optional(),
});

export const suggestSchema = z.object({
  class: handledClass,
  title: z.string().max(255),
  orgId: z.number().int().positive().optional(),
  callerId: z.number().int().positive().optional(),
  serviceId: z.number().int().positive().optional(),
  ciIds: z.array(z.number().int().positive()).max(50).optional(),
  excludeId: z.number().int().positive().optional(),
});

export const cancelSchema = z.object({ reason: z.string().max(2_000) });

export const worklogSchema = z.object({
  minutes: z.number().int(),
  note: z.string().max(5_000),
  workDate: day.optional(),
});

export const reportQuerySchema = z.object({
  from: day.optional(),
  to: day.optional(),
  userId: intParam(1, 1_000_000_000, 0).transform((n) => (n === 0 ? undefined : n)),
});

const draftKind = z.enum(["incident", "user-request", "portal-request"]);

export const draftSchema = z.object({
  kind: draftKind,
  title: z.string().max(255).optional(),
  data: z.record(z.unknown()),
});

export const draftListQuery = z.object({ kind: draftKind.optional() });
