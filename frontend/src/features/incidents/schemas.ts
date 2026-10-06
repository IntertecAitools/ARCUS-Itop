/** iTop Incident status codes (standard datamodel) */
export const incidentStatuses = [
  'new',
  'escalated_tto',
  'assigned',
  'escalated_ttr',
  'waiting_for_approval',
  'pending',
  'resolved',
  'closed',
] as const;
