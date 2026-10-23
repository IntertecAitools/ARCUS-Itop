// portal: feature types. Mirror backend/src/platform/portal/portal.service.ts.
import type { TicketPriority, TicketStatus } from '@/types/ticket';

export type PortalAction = 'close' | 'reopen';

export interface PortalTicket {
  id: number;
  ref: string;
  kind: 'request' | 'incident';
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  service: string;
  subcategory: string;
  /** When it should be resolved by (the SLA's deadline, ISO instant); "" when no SLA applies. */
  targetDate: string;
  targetMissed: boolean;
}

export interface PortalTicketDetail extends PortalTicket {
  description: string;
  solution: string;
  caller: string;
  agent: string;
  team: string;
  resolvedAt: string;
  closedAt: string;
  urgency: string;
  impact: string;
  satisfaction: string;
  userComment: string;
  log: Array<{ date: string; author: string; message: string }>;
  actions: PortalAction[];
}

export interface PortalTicketList {
  items: PortalTicket[];
  total: number;
  page: number;
  pages: number;
}

export interface CatalogService {
  id: number;
  name: string;
  description: string;
  family: string;
  subcategories: Array<{ id: number; name: string; description: string }>;
}

export interface Faq {
  id: number;
  title: string;
  summary: string;
  category: string;
  description?: string;
}

export interface PortalProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobilePhone: string;
  function: string;
  organization: string;
}

export interface NewRequest {
  title: string;
  description: string;
  serviceId?: number;
  subcategoryId?: number;
  urgency?: string;
  /** Answers to the catalogue item's request form, by field key. */
  answers?: Record<string, string>;
}
