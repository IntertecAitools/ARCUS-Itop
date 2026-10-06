import { z } from 'zod';

/** A value picked in a lookup select */
export const lookupOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  hint: z.string().optional(),
});

export const contactRoleCodes = ['manual', 'computed', 'do_not_notify'] as const;
