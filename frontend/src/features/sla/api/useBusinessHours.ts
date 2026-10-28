import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  assignWindow,
  createCalendar,
  createHoliday,
  createWindow,
  deleteCalendar,
  deleteHoliday,
  deleteWindow,
  getBusinessHours,
  updateWindow,
} from './business-hours.api';
import type { AssignmentInput, CalendarInput, CoverageWindowInput, HolidayInput } from '../business-hours.types';

export function useBusinessHours() {
  return useQuery({ queryKey: queryKeys.sla.businessHours(), queryFn: getBusinessHours });
}

/**
 * Every write reloads the whole screen's answer (it is one request), and the
 * SLA dashboard's, whose percentages follow the windows.
 */
function useWrite<T>(run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sla.all() }),
  });
}

export const useSaveWindow = () =>
  useWrite(({ id, input }: { id?: string; input: CoverageWindowInput }) =>
    id ? updateWindow(id, input) : createWindow(input),
  );
export const useDeleteWindow = () => useWrite((id: string) => deleteWindow(id));
export const useCreateCalendar = () => useWrite((input: CalendarInput) => createCalendar(input));
export const useDeleteCalendar = () => useWrite((id: string) => deleteCalendar(id));
export const useCreateHoliday = () => useWrite((input: HolidayInput) => createHoliday(input));
export const useDeleteHoliday = () => useWrite((id: string) => deleteHoliday(id));
export const useAssignWindow = () =>
  useWrite(({ id, input }: { id: string; input: AssignmentInput }) => assignWindow(id, input));
