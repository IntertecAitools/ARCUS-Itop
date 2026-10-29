import { z } from "zod";

const id = z.string().regex(/^\d+$/, "must be a numeric id");
/** An optional criterion: absent or "" means "any". */
const criterion = id.or(z.literal("")).optional().transform((value) => value || undefined);
const ticketType = z.enum(["incident", "request"]);

export const ruleSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1, "Name the rule").max(120),
  enabled: z.boolean(),
  ticketType: ticketType.or(z.literal("")).optional().transform((value) => value || undefined),
  organizationId: criterion,
  serviceId: criterion,
  serviceSubcategoryId: criterion,
  teamId: id,
});

export const assignmentRulesSchema = z.object({
  rules: z.array(ruleSchema).max(200, "At most 200 rules"),
  notifyTeam: z.boolean(),
});

export const ruleTestSchema = z.object({
  ticketType,
  organizationId: criterion,
  serviceId: criterion,
  serviceSubcategoryId: criterion,
});

export const takeParamSchema = z.object({
  type: ticketType,
  id,
});
