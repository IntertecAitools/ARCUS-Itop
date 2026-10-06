/** One entry of an iTop case log (e.g. Problem.private_log). Entries are add-only. */
export interface CaseLogEntry {
  date: string;
  user_login: string;
  user_name?: string;
  message_html: string;
}

/** iTop Ticket priority: 1 Critical · 2 High · 3 Medium · 4 Low */
export type TicketPriority = '1' | '2' | '3' | '4';

/** Compact ticket row used for linked Incidents / UserRequests */
export interface LinkedTicket {
  id: string;
  ref: string;
  title: string;
  /** iTop status code of that ticket class */
  status: string;
  priority: TicketPriority;
  start_date: string;
  org_name?: string;
}
