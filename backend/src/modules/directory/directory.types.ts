/**
 * DTOs for the directory module: organisations, people and teams.
 *
 * These are the records a helpdesk needs BEFORE a ticket can exist — iTop
 * requires an organisation on every Person, Team and Incident, so onboarding
 * runs company -> people -> teams -> tickets.
 *
 * `frontend/src/features/directory/types.ts` mirrors this file.
 */

export type RecordStatus = 'active' | 'inactive';

export interface OrganizationDto {
  id: string;
  name: string;
  code?: string;
  status: RecordStatus;
  parent?: { id: string; name: string };
  /** Populated on the detail view only — counting costs an extra query. */
  counts?: { people: number; teams: number };
}

export interface PersonDto {
  id: string;
  firstName: string;
  lastName: string;
  /** `First Last`, precomputed so every list renders it identically. */
  fullName: string;
  email?: string;
  phone?: string;
  mobile?: string;
  function?: string;
  employeeNumber?: string;
  status: RecordStatus;
  organization: { id: string; name: string };
  manager?: { id: string; name: string };
  /** Teams this person belongs to. Detail view only. */
  teams?: Array<{ id: string; name: string; role?: string }>;
}

export interface TeamDto {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  function?: string;
  status: RecordStatus;
  organization: { id: string; name: string };
  /** Members. Detail view only. */
  members?: Array<{ id: string; name: string; role?: string }>;
  memberCount?: number;
}

export interface DirectoryListQuery {
  page: number;
  limit: number;
  q?: string;
  status?: RecordStatus;
  /** Scope people/teams to one organisation. */
  organizationId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface DirectoryListResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
}

export interface CreateOrganizationInput {
  name: string;
  code?: string;
  status?: RecordStatus;
  parentId?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  code?: string;
  status?: RecordStatus;
  parentId?: string | null;
}

export interface CreatePersonInput {
  firstName: string;
  lastName: string;
  organizationId: string;
  email?: string;
  phone?: string;
  mobile?: string;
  function?: string;
  employeeNumber?: string;
  managerId?: string;
  status?: RecordStatus;
}

export interface UpdatePersonInput {
  firstName?: string;
  lastName?: string;
  organizationId?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  function?: string;
  employeeNumber?: string;
  managerId?: string | null;
  status?: RecordStatus;
}

export interface CreateTeamInput {
  name: string;
  organizationId: string;
  email?: string;
  phone?: string;
  function?: string;
  status?: RecordStatus;
}

export interface UpdateTeamInput {
  name?: string;
  organizationId?: string;
  email?: string;
  phone?: string;
  function?: string;
  status?: RecordStatus;
}

/** Pickers every directory form needs, in one request. */
export interface DirectoryOptions {
  organizations: Array<{ value: string; label: string }>;
  people: Array<{ value: string; label: string }>;
  teams: Array<{ value: string; label: string }>;
  statuses: Array<{ value: string; label: string }>;
}
