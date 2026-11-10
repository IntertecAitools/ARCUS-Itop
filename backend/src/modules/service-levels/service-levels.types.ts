/**
 * Service levels: the targets (SLTs), the SLAs that group them, and the
 * customer contracts whose services each run under one SLA.
 *
 * How iTop picks a ticket's deadline: the caller's organisation → its
 * customer contract → the line for the ticket's service → that line's SLA →
 * the SLA's target for the ticket's type, priority and metric (TTO or TTR).
 */

export const METRICS = ["tto", "ttr"] as const;
export const REQUEST_TYPES = ["incident", "service_request"] as const;
export const PRIORITIES = ["1", "2", "3", "4"] as const;
export const UNITS = ["minutes", "hours"] as const;
export const CONTRACT_STATUSES = ["implementation", "production", "obsolete"] as const;

export type Metric = (typeof METRICS)[number];
export type RequestType = (typeof REQUEST_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Unit = (typeof UNITS)[number];
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface Option {
  id: string;
  name: string;
}

/** One SLT: "P1 incidents are resolved within 4 hours". */
export interface ServiceTarget {
  id: string;
  name: string;
  requestType: RequestType | "";
  priority: Priority | "";
  metric: Metric | "";
  value: number;
  unit: Unit | "";
  /** How many SLAs include it. */
  usedBy: number;
}

export interface ServiceLevelAgreement {
  id: string;
  name: string;
  description: string;
  providerId: string;
  providerName: string;
  targetIds: string[];
  /** How many contract services run under it. */
  usedBy: number;
}

/** One service on a customer contract (a lnkCustomerContractToService row). */
export interface ContractService {
  id: string;
  serviceId: string;
  serviceName: string;
  slaId: string;
  slaName: string;
}

export interface CustomerContract {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  providerId: string;
  providerName: string;
  status: ContractStatus | "";
  startDate: string;
  endDate: string;
  services: ContractService[];
}

export interface ServiceLevels {
  targets: ServiceTarget[];
  slas: ServiceLevelAgreement[];
  contracts: CustomerContract[];
  services: Option[];
  organizations: Option[];
}

export interface TargetInput {
  name: string;
  requestType: RequestType;
  priority: Priority;
  metric: Metric;
  value: number;
  unit: Unit;
}

export interface SlaInput {
  name: string;
  description: string;
  providerId: string;
  targetIds: string[];
}

export interface ContractInput {
  name: string;
  customerId: string;
  providerId: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
}

export interface ContractServiceInput {
  serviceId: string;
  slaId: string;
}
