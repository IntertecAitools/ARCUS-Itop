import { apiClient } from '@/lib/api-client';
import type { AutoCloseDto, AutoCloseRun, AutoCloseSettings } from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

export function getAutoClose() {
  return apiClient.get<AutoCloseDto>('/admin/auto-close');
}

export function saveAutoClose(settings: AutoCloseSettings) {
  return apiClient.put<AutoCloseDto>('/admin/auto-close', settings);
}

export function runAutoClose() {
  return apiClient.post<AutoCloseRun>('/admin/auto-close/run', {});
}
