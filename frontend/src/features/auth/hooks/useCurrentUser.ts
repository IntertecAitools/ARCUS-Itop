import { useSessionStore } from '@/stores';
import { hasPermission } from '../schemas';
import type { Permission } from '../types';

export function useCurrentUser() {
  return useSessionStore((s) => s.user);
}

/** `can('problem:write')` → whether to show create / edit / transition actions */
export function usePermissions() {
  const user = useCurrentUser();
  return { can: (permission: Permission) => hasPermission(user, permission) };
}
