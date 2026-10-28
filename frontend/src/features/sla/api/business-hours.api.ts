import { apiClient } from '@/lib/api-client';
import type {
  AssignmentInput,
  BusinessHours,
  CalendarInput,
  CoverageWindowInput,
  HolidayInput,
} from '../business-hours.types';

/** Raw BFF calls for business hours. Components use the hooks, never this file. */

const BASE = '/admin/business-hours';

export const getBusinessHours = () => apiClient.get<BusinessHours>(BASE);

export const createWindow = (input: CoverageWindowInput) =>
  apiClient.post<{ id: string }>(`${BASE}/coverage-windows`, input);
export const updateWindow = (id: string, input: CoverageWindowInput) =>
  apiClient.put<{ ok: true }>(`${BASE}/coverage-windows/${id}`, input);
export const deleteWindow = (id: string) => apiClient.delete<{ detached: number }>(`${BASE}/coverage-windows/${id}`);

export const createCalendar = (input: CalendarInput) => apiClient.post<{ id: string }>(`${BASE}/calendars`, input);
export const deleteCalendar = (id: string) => apiClient.delete<{ ok: true }>(`${BASE}/calendars/${id}`);

export const createHoliday = (input: HolidayInput) => apiClient.post<{ id: string }>(`${BASE}/holidays`, input);
export const deleteHoliday = (id: string) => apiClient.delete<{ ok: true }>(`${BASE}/holidays/${id}`);

export const assignWindow = (id: string, input: AssignmentInput) =>
  apiClient.put<{ ok: true }>(`${BASE}/assignments/${id}`, input);
