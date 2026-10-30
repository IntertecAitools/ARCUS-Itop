import type { Navigation } from '@/features/navigation';
import type { ClassInfo, ClassList, CriterionKind, CriterionOp, RecordDto } from '@/features/records/types';

/**
 * A slice of the schema the BFF publishes, taken from a real iTop 3.4
 * (`/api/meta/*`) and cut down to what the generic record screens and the
 * notification editor need. Two classes are described in full: Organization
 * (no lifecycle, a handful of fields) and User Request (for rule conditions).
 */

const STRING_OPS: CriterionOp[] = ['contains', 'not_contains', 'starts_with', 'ends_with', 'equals', 'not_equals', 'empty', 'not_empty'];
const SET_OPS: CriterionOp[] = ['in', 'not_in', 'empty', 'not_empty'];
const criterion = (kind: CriterionKind) => ({ kind, ops: kind === 'string' ? STRING_OPS : SET_OPS });

export const classList: ClassList = {
  classes: [
    { name: 'Organization', isCi: false, abstract: false, parent: 'cmdbAbstractObject', inherits: ['cmdbAbstractObject'], hasLifecycle: false, counts: { writable: 5, readonly: 2, related: 0, pickers: 2 } },
    { name: 'Person', isCi: false, abstract: false, parent: 'Contact', inherits: ['cmdbAbstractObject', 'Contact'], hasLifecycle: false, counts: { writable: 13, readonly: 3, related: 4, pickers: 3 } },
    { name: 'UserRequest', isCi: false, abstract: false, parent: 'Ticket', inherits: ['cmdbAbstractObject', 'Ticket'], hasLifecycle: true, counts: { writable: 49, readonly: 12, related: 5, pickers: 11 } },
  ],
  groups: { ci: [], abstract: [] },
};

export const organizationInfo: ClassInfo = {
  name: 'Organization',
  isCi: false,
  abstract: false,
  parent: 'cmdbAbstractObject',
  inherits: ['cmdbAbstractObject'],
  lifecycle: null,
  presentation: {
    columns: [{ id: 'col:0', fieldsets: [{ id: 'fieldset:baseinfo', label: 'General information', fields: ['name', 'code', 'status', 'parent_id'] }] }],
    list: ['code', 'status', 'parent_id'],
    related: [],
  },
  labels: {
    class: 'Organization',
    fields: { code: 'Code', name: 'Name', parent_id: 'Parent', parent_name: 'Parent name', status: 'Status' },
    values: { status: { active: 'Active', inactive: 'Inactive' } },
  },
  writable: ['code', 'name', 'parent_id', 'status'],
  readonly: ['parent_name'],
  related: [],
  pickers: ['parent_id'],
  searchable: ['name', 'code'],
  criteria: { code: criterion('string'), name: criterion('string'), parent_id: criterion('key'), status: criterion('enum') },
  fields: {
    code: { type: 'String', ui: 'scalar', owner: 'Organization', required: false, hasDefault: false },
    name: { type: 'String', ui: 'scalar', owner: 'Organization', required: true, hasDefault: false },
    parent_id: { type: 'HierarchicalKey', ui: 'picker', owner: 'Organization', required: false, hasDefault: false, target: 'Organization' },
    parent_name: { type: 'ExternalField', ui: 'readonly', owner: 'Organization', required: false, hasDefault: false, viaKey: 'parent_id', viaAttribute: 'name' },
    status: { type: 'Enum', ui: 'scalar', owner: 'Organization', required: false, hasDefault: true, values: ['active', 'inactive'] },
  },
};

const PRIORITIES = { '1': 'Critical', '2': 'High', '3': 'Medium', '4': 'Low' };

export const userRequestInfo: ClassInfo = {
  name: 'UserRequest',
  isCi: false,
  abstract: false,
  parent: 'Ticket',
  inherits: ['cmdbAbstractObject', 'Ticket'],
  // The real class has one; nothing these mocks serve needs it.
  lifecycle: null,
  presentation: {
    columns: [{ id: 'col:0', fieldsets: [{ id: 'fieldset:baseinfo', label: 'General information', fields: ['ref', 'title', 'status', 'priority', 'caller_id', 'description'] }] }],
    list: ['title', 'status', 'priority', 'caller_id'],
    related: [],
  },
  labels: {
    class: 'User Request',
    fields: { caller_id: 'Caller', description: 'Description', priority: 'Priority', ref: 'Ref', status: 'Status', title: 'Title' },
    values: {
      priority: PRIORITIES,
      status: { new: 'New', assigned: 'Assigned', pending: 'Pending', resolved: 'Resolved', closed: 'Closed' },
    },
  },
  writable: ['caller_id', 'description', 'priority', 'ref', 'status', 'title'],
  readonly: [],
  related: [],
  pickers: ['caller_id'],
  searchable: ['ref', 'description', 'title'],
  criteria: {
    caller_id: criterion('key'),
    description: criterion('string'),
    priority: criterion('enum'),
    ref: criterion('string'),
    status: criterion('enum'),
    title: criterion('string'),
  },
  fields: {
    caller_id: { type: 'ExternalKey', ui: 'picker', owner: 'Ticket', required: false, hasDefault: false, target: 'Person' },
    description: { type: 'Text', ui: 'scalar', owner: 'Ticket', required: true, hasDefault: false },
    priority: { type: 'Enum', ui: 'scalar', owner: 'UserRequest', required: true, hasDefault: true, values: ['1', '2', '3', '4'] },
    ref: { type: 'String', ui: 'scalar', owner: 'Ticket', required: false, hasDefault: false },
    status: { type: 'Enum', ui: 'scalar', owner: 'UserRequest', required: true, hasDefault: true, values: ['new', 'assigned', 'pending', 'resolved', 'closed'] },
    title: { type: 'String', ui: 'scalar', owner: 'Ticket', required: true, hasDefault: false },
  },
};

/**
 * Incident, enough for the generic record screen incidents open on: a few
 * fields and iTop's lifecycle (Resolve asks for a solution). The records
 * themselves come from the incidents mock, so both screens share one store.
 */
export const incidentInfo: ClassInfo = {
  name: 'Incident',
  isCi: false,
  abstract: false,
  parent: 'Ticket',
  inherits: ['cmdbAbstractObject', 'Ticket'],
  lifecycle: {
    attribute: 'status',
    states: {
      new: ['ev_assign'],
      assigned: ['ev_pending', 'ev_resolve', 'ev_reassign'],
      pending: ['ev_assign'],
      resolved: ['ev_close', 'ev_reopen'],
      closed: [],
    },
    stimuli: ['ev_assign', 'ev_reassign', 'ev_pending', 'ev_resolve', 'ev_close', 'ev_reopen'],
    userActions: ['ev_assign', 'ev_reassign', 'ev_pending', 'ev_resolve', 'ev_close', 'ev_reopen'],
    transitions: {
      new: { ev_assign: 'assigned' },
      assigned: { ev_pending: 'pending', ev_resolve: 'resolved', ev_reassign: 'assigned' },
      pending: { ev_assign: 'assigned' },
      resolved: { ev_close: 'closed', ev_reopen: 'assigned' },
    },
    flags: { resolved: { solution: ['mandatory', 'must_prompt'] } },
  },
  presentation: {
    columns: [{ id: 'col:0', fieldsets: [{ id: 'fieldset:baseinfo', label: 'General information', fields: ['ref', 'title', 'status', 'priority', 'agent_id', 'description', 'solution'] }] }],
    list: ['title', 'status', 'priority', 'agent_id'],
    related: [],
  },
  labels: {
    class: 'Incident',
    fields: { agent_id: 'Agent', description: 'Description', priority: 'Priority', ref: 'Ref', solution: 'Solution', status: 'Status', title: 'Title' },
    values: {
      status: { new: 'New', assigned: 'Assigned', pending: 'Pending', resolved: 'Resolved', closed: 'Closed' },
    },
    stimuli: { ev_assign: 'Assign', ev_reassign: 'Reassign', ev_pending: 'Pending', ev_resolve: 'Resolve', ev_close: 'Close', ev_reopen: 'Reopen' },
  },
  writable: ['description', 'priority', 'solution', 'status', 'title'],
  readonly: ['ref', 'agent_id'],
  related: [],
  pickers: [],
  searchable: ['ref', 'title'],
  fields: {
    agent_id: { type: 'ExternalKey', ui: 'picker', owner: 'Ticket', required: false, hasDefault: false, target: 'Person' },
    description: { type: 'Text', ui: 'scalar', owner: 'Ticket', required: true, hasDefault: false },
    priority: { type: 'Enum', ui: 'scalar', owner: 'Incident', required: true, hasDefault: true },
    ref: { type: 'String', ui: 'scalar', owner: 'Ticket', required: false, hasDefault: false },
    solution: { type: 'Text', ui: 'scalar', owner: 'Incident', required: false, hasDefault: false },
    status: { type: 'Enum', ui: 'scalar', owner: 'Incident', required: true, hasDefault: true, values: ['new', 'assigned', 'pending', 'resolved', 'closed'] },
    title: { type: 'String', ui: 'scalar', owner: 'Ticket', required: true, hasDefault: false },
  },
};

export const classInfos: Record<string, ClassInfo> = {
  Organization: organizationInfo,
  UserRequest: userRequestInfo,
  Incident: incidentInfo,
};

const organization = (id: number, name: string, code: string, status: string, parent?: { id: number; name: string }): RecordDto => ({
  class: 'Organization',
  id,
  label: name,
  fields: {
    id: String(id),
    friendlyname: name,
    name,
    code,
    status,
    parent_id: parent ? String(parent.id) : '0',
    parent_id_friendlyname: parent?.name ?? '',
    parent_name: parent?.name ?? '',
  },
});

export const records: Record<string, RecordDto[]> = {
  Organization: [
    organization(1, 'Demo Company', 'DEMO', 'active'),
    organization(2, 'Northwind Traders', 'NWT', 'active', { id: 1, name: 'Demo Company' }),
    organization(3, 'Contoso Facilities', 'CON', 'active', { id: 1, name: 'Demo Company' }),
    organization(4, 'Fabrikam Archive', 'FAB', 'inactive'),
  ],
  Person: [
    { class: 'Person', id: 1, label: 'Mock Administrator', fields: { id: '1', friendlyname: 'Mock Administrator' } },
    { class: 'Person', id: 2, label: 'Ravi Kumar', fields: { id: '2', friendlyname: 'Ravi Kumar' } },
    { class: 'Person', id: 9, label: 'Pia Portal', fields: { id: '9', friendlyname: 'Pia Portal' } },
  ],
};

/** iTop's menus, as the BFF publishes them: enough for the sidebar's Modules group. */
export const navigation: Navigation = {
  groups: [
    {
      id: 'RequestManagement',
      label: 'Helpdesk',
      isAdmin: false,
      entries: [
        { id: 'NewUserRequest', kind: 'create', class: 'UserRequest', label: 'New request', filtered: false, creatable: true },
        { id: 'UserRequest:OpenRequests', kind: 'list', class: 'UserRequest', label: 'Open', filtered: true, creatable: true },
      ],
    },
    {
      id: 'ConfigManagement',
      label: 'Configuration management',
      isAdmin: false,
      entries: [{ id: 'Organization', kind: 'list', class: 'Organization', label: 'Organizations', filtered: false, creatable: true }],
    },
  ],
  classLabels: { Organization: 'Organization', Person: 'Person', UserRequest: 'User Request' },
  excluded: [],
  counts: { groups: 2, entries: 3, views: 1, excluded: 0 },
};
