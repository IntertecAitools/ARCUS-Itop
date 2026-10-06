/**
 * Reference data mirroring a small iTop instance: organizations, persons, teams,
 * services, functional CIs, changes and the users who can sign in.
 */

export interface OrgRecord {
  id: string;
  name: string;
}

export interface PersonRecord {
  id: string;
  name: string;
  email: string;
  org_id: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  members: string[];
}

export interface ServiceRecord {
  id: string;
  name: string;
  subcategories: Array<{ id: string; name: string }>;
}

export interface CiRecord {
  id: string;
  name: string;
  finalclass: string;
}

export interface ChangeRecord {
  id: string;
  ref: string;
  title: string;
  finalclass: 'NormalChange' | 'RoutineChange' | 'EmergencyChange';
  status: 'new' | 'assigned' | 'planned' | 'approved' | 'implemented' | 'monitored' | 'closed';
}

export interface UserRecord {
  id: string;
  login: string;
  password: string;
  person_id: string;
  roleCode: string;
  profiles: string[];
}

export const orgs: OrgRecord[] = [
  { id: '1', name: 'Demo Corp' },
  { id: '2', name: 'Northwind Retail' },
  { id: '3', name: 'Contoso Health' },
  { id: '4', name: 'Fabrikam Logistics' },
];

export const persons: PersonRecord[] = [
  { id: '1', name: 'Alex Morgan', email: 'alex.morgan@democorp.example', org_id: '1' },
  { id: '2', name: 'Priya Sharma', email: 'priya.sharma@democorp.example', org_id: '1' },
  { id: '3', name: 'Daniel Okafor', email: 'daniel.okafor@democorp.example', org_id: '1' },
  { id: '4', name: 'Mei Lin', email: 'mei.lin@democorp.example', org_id: '1' },
  { id: '5', name: 'Lucas Ferreira', email: 'lucas.ferreira@democorp.example', org_id: '1' },
  { id: '6', name: 'Sara Nilsson', email: 'sara.nilsson@democorp.example', org_id: '1' },
  { id: '7', name: 'Omar Haddad', email: 'omar.haddad@democorp.example', org_id: '1' },
  { id: '8', name: 'Grace Kim', email: 'grace.kim@northwind.example', org_id: '2' },
  { id: '9', name: 'Tom Becker', email: 'tom.becker@northwind.example', org_id: '2' },
  { id: '10', name: 'Aisha Bello', email: 'aisha.bello@contoso.example', org_id: '3' },
  { id: '11', name: 'Jonas Weber', email: 'jonas.weber@contoso.example', org_id: '3' },
  { id: '12', name: 'Elena Rossi', email: 'elena.rossi@fabrikam.example', org_id: '4' },
  { id: '13', name: 'Ravi Patel', email: 'ravi.patel@fabrikam.example', org_id: '4' },
];

export const teams: TeamRecord[] = [
  { id: '101', name: 'Problem Management', members: ['1', '3'] },
  { id: '102', name: 'Service Desk', members: ['2', '7'] },
  { id: '103', name: 'Network Operations', members: ['4', '5'] },
  { id: '104', name: 'Application Support', members: ['6', '3', '1'] },
];

export const services: ServiceRecord[] = [
  {
    id: '1',
    name: 'Email & Collaboration',
    subcategories: [
      { id: '11', name: 'Mailbox' },
      { id: '12', name: 'Calendar' },
      { id: '13', name: 'Chat & meetings' },
    ],
  },
  {
    id: '2',
    name: 'Network Connectivity',
    subcategories: [
      { id: '21', name: 'VPN' },
      { id: '22', name: 'Wi-Fi' },
      { id: '23', name: 'WAN links' },
    ],
  },
  {
    id: '3',
    name: 'ERP',
    subcategories: [
      { id: '31', name: 'Finance module' },
      { id: '32', name: 'Inventory module' },
    ],
  },
  {
    id: '4',
    name: 'Customer Portal',
    subcategories: [
      { id: '41', name: 'Login & SSO' },
      { id: '42', name: 'Payments' },
    ],
  },
  {
    id: '5',
    name: 'Desktop Services',
    subcategories: [
      { id: '51', name: 'Laptops' },
      { id: '52', name: 'Printing' },
    ],
  },
];

export const cis: CiRecord[] = [
  { id: '1', name: 'srv-mail-01', finalclass: 'Server' },
  { id: '2', name: 'srv-mail-02', finalclass: 'Server' },
  { id: '3', name: 'srv-erp-app-01', finalclass: 'Server' },
  { id: '4', name: 'srv-db-02', finalclass: 'Server' },
  { id: '5', name: 'erp_prod', finalclass: 'DatabaseSchema' },
  { id: '6', name: 'ERP Web', finalclass: 'WebApplication' },
  { id: '7', name: 'Customer Portal', finalclass: 'WebApplication' },
  { id: '8', name: 'Payments', finalclass: 'ApplicationSolution' },
  { id: '9', name: 'Email Service', finalclass: 'ApplicationSolution' },
  { id: '10', name: 'fw-edge-01', finalclass: 'NetworkDevice' },
  { id: '11', name: 'core-sw-01', finalclass: 'NetworkDevice' },
  { id: '12', name: 'vpn-gw-01', finalclass: 'NetworkDevice' },
  { id: '13', name: 'vm-portal-01', finalclass: 'VirtualMachine' },
  { id: '14', name: 'vm-portal-02', finalclass: 'VirtualMachine' },
  { id: '15', name: 'kafka-cluster-prod', finalclass: 'Middleware' },
  { id: '16', name: 'prn-hq-3f', finalclass: 'Printer' },
  { id: '17', name: 'lt-0142', finalclass: 'PC' },
];

export const changes: ChangeRecord[] = [
  { id: '1', ref: 'C-000101', title: 'Upgrade VPN gateway firmware', finalclass: 'NormalChange', status: 'planned' },
  { id: '2', ref: 'C-000102', title: 'Patch mail servers', finalclass: 'RoutineChange', status: 'implemented' },
  { id: '3', ref: 'C-000103', title: 'Increase ERP DB connection pool', finalclass: 'NormalChange', status: 'approved' },
  { id: '4', ref: 'C-000104', title: 'Replace core switch', finalclass: 'NormalChange', status: 'closed' },
  { id: '5', ref: 'C-000105', title: 'Portal payment API timeout fix', finalclass: 'EmergencyChange', status: 'new' },
  { id: '6', ref: 'C-000106', title: 'Rotate portal TLS certificates', finalclass: 'RoutineChange', status: 'closed' },
  { id: '7', ref: 'C-000107', title: 'Kafka broker heap tuning', finalclass: 'NormalChange', status: 'assigned' },
];

export const users: UserRecord[] = [
  {
    id: 'u1',
    login: 'admin',
    password: 'admin',
    person_id: '1',
    roleCode: 'ROLE_BUSINESS_ADMIN',
    profiles: ['Administrator', 'Problem Manager'],
  },
  {
    id: 'u2',
    login: 'agent',
    password: 'agent',
    person_id: '2',
    roleCode: 'ROLE_SUPPORT_AGENT',
    profiles: ['Support Agent'],
  },
];
