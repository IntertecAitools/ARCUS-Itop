import { z } from 'zod';

export const serviceSelectionSchema = z.object({
  service: z.object({ id: z.string(), label: z.string() }).nullable(),
  subcategory: z.object({ id: z.string(), label: z.string() }).nullable(),
});
