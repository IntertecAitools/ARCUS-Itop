/** iTop lnkContactToTicket.role_code */
export type ContactRoleCode = 'manual' | 'computed' | 'do_not_notify';

/** Entry of a ticket's contacts_list */
export interface LinkedContact {
  contact_id: string;
  contact_name: string;
  contact_email?: string;
  role_code: ContactRoleCode;
}

/** Scope for person lookups: iTop filters callers by org and agents by team */
export interface PersonScope {
  orgId?: string;
  teamId?: string;
}
