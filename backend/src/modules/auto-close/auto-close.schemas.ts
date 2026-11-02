import { z } from "zod";

export const autoCloseSettingsSchema = z
  .object({
    enabled: z.boolean(),
    days: z.number().int().min(1, "At least 1 day").max(365, "At most 365 days"),
    requests: z.boolean(),
    incidents: z.boolean(),
    remind: z.boolean(),
    remindDaysBefore: z.number().int().min(1, "At least 1 day").max(364),
  })
  .refine((s) => !s.remind || s.remindDaysBefore < s.days, {
    message: "The reminder has to go before the ticket closes: fewer days than the closing delay.",
    path: ["remindDaysBefore"],
  });
