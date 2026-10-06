import { z } from 'zod';

export const relatedChangeSchema = z.object({
  change: z.object({ id: z.string(), label: z.string() }).nullable(),
});
