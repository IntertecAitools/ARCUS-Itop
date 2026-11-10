import { apiClient } from '@/lib/api-client';
import type { ContractInput, ServiceLevels, SlaInput, TargetInput } from '../service-levels.types';

/** Raw BFF calls for service levels. Components use the hooks, never this file. */

const BASE = '/admin/service-levels';

export const getServiceLevels = () => apiClient.get<ServiceLevels>(BASE);

export const createTarget = (input: TargetInput) => apiClient.post<{ id: string }>(`${BASE}/targets`, input);
export const updateTarget = (id: string, input: TargetInput) => apiClient.put<{ ok: true }>(`${BASE}/targets/${id}`, input);
export const deleteTarget = (id: string) => apiClient.delete<{ ok: true }>(`${BASE}/targets/${id}`);

export const createSla = (input: SlaInput) => apiClient.post<{ id: string }>(`${BASE}/slas`, input);
export const updateSla = (id: string, input: SlaInput) => apiClient.put<{ ok: true }>(`${BASE}/slas/${id}`, input);
export const deleteSla = (id: string) => apiClient.delete<{ detached: number }>(`${BASE}/slas/${id}`);

export const createContract = (input: ContractInput) => apiClient.post<{ id: string }>(`${BASE}/contracts`, input);
export const updateContract = (id: string, input: ContractInput) =>
  apiClient.put<{ ok: true }>(`${BASE}/contracts/${id}`, input);
export const deleteContract = (id: string) => apiClient.delete<{ ok: true }>(`${BASE}/contracts/${id}`);

export const addContractService = (contractId: string, input: { serviceId: string; slaId: string }) =>
  apiClient.post<{ id: string }>(`${BASE}/contracts/${contractId}/services`, input);
export const setContractServiceSla = (id: string, slaId: string) =>
  apiClient.put<{ ok: true }>(`${BASE}/contract-services/${id}`, { slaId });
export const removeContractService = (id: string) => apiClient.delete<{ ok: true }>(`${BASE}/contract-services/${id}`);
