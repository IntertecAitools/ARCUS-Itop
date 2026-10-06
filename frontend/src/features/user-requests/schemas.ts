/** iTop UserRequest status codes (standard datamodel) */
export const userRequestStatuses = [
  'new',
  'escalated_tto',
  'assigned',
  'escalated_ttr',
  'waiting_for_approval',
  'approved',
  'rejected',
  'pending',
  'resolved',
  'closed',
] as const;
