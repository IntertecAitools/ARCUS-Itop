// incidents: Zod form schemas.
import { z } from 'zod';

/**
 * Mirrors the backend's `createIncidentSchema`, so the form catches what the
 * API would reject — before a round trip.
 *
 * There is deliberately no `priority`: iTop derives it from urgency × impact.
 */
export const newIncidentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'A subject is required')
    .max(255, 'Keep the title under 255 characters'),
  description: z.string().trim().min(1, 'Describe what is happening').max(10_000),
  organizationId: z.string().min(1, 'Choose a customer'),
  callerId: z.string().optional(),
  // Required because priority is derived from the pair; without both, iTop
  // would fall back to a default the reporter never chose.
  urgency: z.string().min(1, 'Choose an urgency'),
  impact: z.string().min(1, 'Choose an impact'),
  origin: z.string().optional(),
  serviceId: z.string().optional(),
  serviceSubcategoryId: z.string().optional(),
  startDate: z.string().optional(),
  agentId: z.string().optional(),
  teamId: z.string().optional(),
});

export type NewIncidentForm = z.infer<typeof newIncidentSchema>;
