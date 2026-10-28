import { z } from "zod";

import { WEEKDAYS } from "./business-hours.types.js";

/** Request validation for the business-hours module. */

export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

/** iTop's AttributeString is a VARCHAR(255). */
const name = z.string().trim().min(1, "a name is required").max(255);

const time = z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "use HH:MM");
const endTime = z.string().regex(/^(([01]?[0-9]|2[0-3]):[0-5][0-9]|24:00)$/, "use HH:MM (24:00 for midnight)");

export const coverageWindowSchema = z.object({
  name,
  description: z.string().max(60_000).default(""),
  intervals: z
    .array(
      z.object({
        weekday: z.enum(WEEKDAYS as [string, ...string[]]),
        start: time,
        end: endTime,
      }),
    )
    .min(1, "a coverage window needs open hours")
    .max(70),
});

export const calendarSchema = z.object({ name });

const isRealDate = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const holidaySchema = z.object({
  name,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD").refine(isRealDate, "not a calendar date"),
  calendarId: z.union([z.string().regex(/^\d+$/), z.literal("")]).default(""),
});

export const assignmentSchema = z.object({
  coverageWindowId: z.union([z.string().regex(/^\d+$/), z.literal("")]),
});
