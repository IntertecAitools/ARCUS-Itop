// auth: Zod form schemas.
import { z } from 'zod';

export const signInSchema = z.object({
  login: z.string().trim().min(1, 'Enter your login.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password.'),
    next: z.string().min(8, 'Use at least 8 characters.'),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ['confirm'], message: 'The passwords do not match.' });
