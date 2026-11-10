/**
 * Service levels, as /api/admin/service-levels answers them: targets (TTO or
 * TTR for one request type and priority), SLAs that group targets, and
 * customer contracts with the SLA each of their services runs under.
 */

export type SlaMetricCode = 'tto' | 'ttr';
export type RequestTypeCode = 'incident' | 'service_request';
export type PriorityCode = '1' | '2' | '3' | '4';
export type TimeUnit = 'minutes' | 'hours';
export type ContractStatus = 'implementation' | 'production' | 'obsolete';

export interface Option {
  id: string;
  name: string;
}

export interface ServiceTarget {
  id: string;
  name: string;
  requestType: RequestTypeCode | '';
  priority: PriorityCode | '';
  metric: SlaMetricCode | '';
  value: number;
  unit: TimeUnit | '';
  usedBy: number;
}

export interface ServiceLevelAgreement {
  id: string;
  name: string;
  description: string;
  providerId: string;
  providerName: string;
  targetIds: string[];
  usedBy: number;
}

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
  status: ContractStatus | '';
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
  requestType: RequestTypeCode;
  priority: PriorityCode;
  metric: SlaMetricCode;
  value: number;
  unit: TimeUnit;
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
