// users: feature types. Mirror backend/src/platform/admin/users.service.ts.

export type AccountType = 'local' | 'ldap' | 'external';

export interface UserSummary {
  id: number;
  login: string;
  type: AccountType | 'other';
  status: 'enabled' | 'disabled';
  name: string;
  email: string;
  contactId: number;
  profiles: string[];
}

export interface UserDetail extends UserSummary {
  profileIds: number[];
  allowedOrgs: Array<{ id: number; name: string }>;
  language: string;
}

export interface UserList {
  items: UserSummary[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Profile {
  id: number;
  name: string;
  description: string;
  /** Whether the signed-in administrator may give or take away this profile. */
  grantable?: boolean;
}

export interface CreateUserInput {
  type: AccountType;
  login: string;
  password?: string;
  contact: { id: number } | { firstName: string; lastName: string; email: string; orgId: number };
  profileIds: number[];
  allowedOrgIds?: number[];
}

export interface UpdateUserInput {
  status?: 'enabled' | 'disabled';
  profileIds?: number[];
  allowedOrgIds?: number[];
}

export interface Option {
  id: number;
  label: string;
}
