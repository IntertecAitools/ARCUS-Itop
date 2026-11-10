import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  addContractService,
  createContract,
  createSla,
  createTarget,
  deleteContract,
  deleteSla,
  deleteTarget,
  getServiceLevels,
  removeContractService,
  setContractServiceSla,
  updateContract,
  updateSla,
  updateTarget,
} from './service-levels.api';
import type { ContractInput, SlaInput, TargetInput } from '../service-levels.types';

export function useServiceLevels() {
  return useQuery({ queryKey: queryKeys.sla.serviceLevels(), queryFn: getServiceLevels });
}

/**
 * Every write reloads the screen's one answer, and everything else under
 * the SLA key (the dashboard, business hours' contract table).
 */
function useWrite<T>(run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sla.all() }),
  });
}

export const useSaveTarget = () =>
  useWrite(({ id, input }: { id?: string; input: TargetInput }) => (id ? updateTarget(id, input) : createTarget(input)));
export const useDeleteTarget = () => useWrite((id: string) => deleteTarget(id));

export const useSaveSla = () =>
  useWrite(({ id, input }: { id?: string; input: SlaInput }) => (id ? updateSla(id, input) : createSla(input)));
export const useDeleteSla = () => useWrite((id: string) => deleteSla(id));

export const useSaveContract = () =>
  useWrite(({ id, input }: { id?: string; input: ContractInput }) =>
    id ? updateContract(id, input) : createContract(input),
  );
export const useDeleteContract = () => useWrite((id: string) => deleteContract(id));

export const useAddContractService = () =>
  useWrite(({ contractId, serviceId, slaId }: { contractId: string; serviceId: string; slaId: string }) =>
    addContractService(contractId, { serviceId, slaId }),
  );
export const useSetContractServiceSla = () =>
  useWrite(({ id, slaId }: { id: string; slaId: string }) => setContractServiceSla(id, slaId));
export const useRemoveContractService = () => useWrite((id: string) => removeContractService(id));
