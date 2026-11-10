import { z } from "zod";

import { CONTRACT_STATUSES, METRICS, PRIORITIES, REQUEST_TYPES, UNITS } from "./service-levels.types.js";

/** Request validation for the service-levels module. */

export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

const id = z.string().regex(/^\d+$/, "must be a numeric id");
const optionalId = z.union([id, z.literal("")]).default("");
/** iTop's AttributeString is a VARCHAR(255). */
const name = z.string().trim().min(1, "a name is required").max(255);

const isRealDate = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const date = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD").refine(isRealDate, "not a calendar date"),
  z.literal(""),
]).default("");

export const targetSchema = z.object({
  name,
  requestType: z.enum(REQUEST_TYPES),
  priority: z.enum(PRIORITIES),
  metric: z.enum(METRICS),
  value: z.number().int("a whole number").positive("more than zero").max(1_000_000),
  unit: z.enum(UNITS),
});

export const slaSchema = z.object({
  name,
  description: z.string().max(60_000).default(""),
  providerId: id,
  targetIds: z.array(id).max(200).default([]),
});

export const contractSchema = z
  .object({
    name,
    customerId: id,
    providerId: id,
    status: z.enum(CONTRACT_STATUSES).default("production"),
    startDate: date,
    endDate: date,
  })
  .refine((c) => !c.startDate || !c.endDate || c.startDate <= c.endDate, {
    message: "the end date is before the start date",
    path: ["endDate"],
  });

export const contractServiceSchema = z.object({
  serviceId: id,
  slaId: optionalId,
});

export const contractServiceUpdateSchema = z.object({
  slaId: optionalId,
});
