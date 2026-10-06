import { z } from 'zod';
import type { CurrentUser } from '@/types';
import type { Permission } from './types';

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'validation.required'),
  password: z.string().min(1, 'validation.required'),
});

export type LoginValues = z.infer<typeof loginSchema>;

/**
 * iTop profiles allowed to write. Mirrors the standard iTop profiles:
 * Problem Manager owns Problems and Known Errors; Administrator can do everything.
 */
export const WRITE_PROFILES: Record<Permission, string[]> = {
  'problem:write': ['Administrator', 'Problem Manager'],
  'knownerror:write': ['Administrator', 'Problem Manager'],
};

export function hasPermission(user: CurrentUser | null, permission: Permission): boolean {
  if (!user) return false;
  return user.profiles.some((p) => WRITE_PROFILES[permission].includes(p));
}
