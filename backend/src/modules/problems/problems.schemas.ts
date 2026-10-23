import { z } from "zod";

/** Request validation for the problems module. */

export const problemIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

/** iTop's AttributeText holds up to 64 KB; well past any analysis. */
const text = z.string().max(60_000).default("");

export const analysisSchema = z.object({
  rootCause: text,
  workaround: text,
  resolution: text,
});

export const createKnownErrorSchema = z
  .object({
    name: z.string().max(255).optional(),
    symptom: z.string().max(60_000).optional(),
    domain: z.enum(["Application", "Desktop", "Network", "Server"]).optional(),
    errorCode: z.string().max(255).optional(),
  })
  .default({});

export const trendQuerySchema = z.object({
  period: z.enum(["30d", "90d", "180d", "365d"]).default("90d"),
  groupBy: z.enum(["service", "ci", "category"]).default("service"),
});
