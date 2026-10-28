import { z } from "zod";

/** Request validation for the sla module. */

const type = z.enum(["all", "incident", "request"]).default("all");
const id = z.string().regex(/^\d+$/, "must be numeric");

export const dashboardQuerySchema = z.object({ type });

export const ticketQuerySchema = z.object({
  type,
  state: z.enum(["within", "at_risk", "breached", "none"]).optional(),
  team: z.union([id, z.literal("none")]).optional(),
  priority: z.enum(["1", "2", "3", "4"]).optional(),
  org: id.optional(),
});
