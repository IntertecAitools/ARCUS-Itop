import { z } from "zod";

/** Request validation for the changes module. */

export const changeIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric").transform(Number),
});

/** iTop's AttributeText holds up to 64 KB. */
const text = z.string().max(60_000);

export const plansSchema = z
  .object({
    implementation: text.optional(),
    rollback: text.optional(),
    test: text.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Send at least one plan.");

export const cabDecisionSchema = z.object({
  meetingDate: z.string().min(10).max(40),
  attendees: z.array(z.string().max(255)).max(100).default([]),
  decision: z.enum(["approved", "rejected", "deferred"]),
  conditions: text.default(""),
  notes: text.default(""),
});

const requirement = z.enum(["plan", "implement", "optional"]);
const typeRule = z.object({ implementation: requirement, rollback: requirement, test: requirement });

export const planRulesSchema = z.object({
  rules: z.object({ routine: typeRule, normal: typeRule, emergency: typeRule }),
});
