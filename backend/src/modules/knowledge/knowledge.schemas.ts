import { z } from "zod";

import { idParam } from "../../core/validate.js";

/** Request validation for the knowledge module. */

const kind = z.enum(["faq", "known_error"]);

export const articleParamsSchema = z.object({ kind, id: idParam });

export const articleListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  state: z.enum(["draft", "in_review", "published", "retired", "review_due"]).optional(),
  kind: kind.optional(),
});

export const articleActionSchema = z.object({
  action: z.enum(["submit", "approve", "send_back", "reviewed", "retire", "restore"]),
  comment: z.string().max(4000).default(""),
  reviewDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "reviewDue must be YYYY-MM-DD")
    .optional(),
});

export const feedbackSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().max(2000).default(""),
});

export const knowledgeSettingsSchema = z.object({
  reviewerProfiles: z.array(z.string().max(255)).max(20),
  reviewIntervalDays: z.number().int().min(7).max(1095),
});
