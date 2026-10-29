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

const numericId = z.string().regex(/^\d+$/, "must be numeric");
const isoInstant = z.string().min(10).max(40);

export const calendarQuerySchema = z.object({
  from: isoInstant,
  to: isoInstant,
  teamId: numericId.optional(),
  ciId: numericId.optional(),
  serviceId: numericId.optional(),
  orgId: numericId.optional(),
});

export const blackoutIdParamSchema = z.object({ id: z.string().uuid() });

export const blackoutSchema = z.object({
  name: z.string().trim().min(1).max(120),
  start: isoInstant,
  end: isoInstant,
  reason: z.string().max(2000).default(""),
});

const perType = <T extends z.ZodTypeAny>(item: T) => z.object({ routine: item, normal: item, emergency: item });
const slug = z.string().trim().min(1).max(64);

const riskQuestionSchema = z.object({
  id: slug,
  text: z.string().trim().min(1).max(500),
  help: z.string().max(1000).default(""),
  weight: z.number().int().min(1).max(10),
  options: z
    .array(z.object({ id: slug, label: z.string().trim().min(1).max(255), score: z.number().int().min(0).max(10) }))
    .min(2)
    .max(10),
});

export const riskModelSchema = z.object({
  model: z.object({
    questions: perType(z.array(riskQuestionSchema).max(30)),
    thresholds: z.object({ medium: z.number().int().min(1).max(99), high: z.number().int().min(2).max(100) }),
    requiredBeforePlan: perType(z.boolean()),
  }),
});

export const riskAnswersSchema = z.object({
  answers: z.record(z.string().max(64), z.string().max(64)),
});

export const pirSchema = z.object({
  outcome: z.enum(["successful", "partial", "failed", "rolled_back"]),
  wentWell: text.default(""),
  wentBadly: text.default(""),
  incidentIds: z.array(numericId).max(50).default([]),
  followUps: z
    .array(
      z.object({
        text: z.string().max(1000),
        owner: z.string().max(255).default(""),
        due: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "due must be YYYY-MM-DD")]).default(""),
        done: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
});
