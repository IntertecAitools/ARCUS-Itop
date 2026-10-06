'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { FormField, describedBy } from '@/components/forms';
import { Button, Input } from '@/components/ui';
import { useLogin } from '../api/auth';
import { loginSchema, type LoginValues } from '../schemas';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { login: '', password: '' } });

  const loginError = errors.login?.message ? tc(errors.login.message) : undefined;
  const passwordError = errors.password?.message ? tc(errors.password.message) : undefined;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((values) => login.mutate(values, { onSuccess }))}
    >
      {login.isError && (
        <div role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft p-3 text-sm text-danger-strong">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {login.error.message}
        </div>
      )}
      <FormField htmlFor="login" label={t('login')} required error={loginError}>
        <Input
          id="login"
          autoComplete="username"
          invalid={!!loginError}
          aria-describedby={describedBy('login', { error: loginError })}
          {...register('login')}
        />
      </FormField>
      <FormField htmlFor="password" label={t('password')} required error={passwordError}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          invalid={!!passwordError}
          aria-describedby={describedBy('password', { error: passwordError })}
          {...register('password')}
        />
      </FormField>
      <Button type="submit" className="w-full justify-center" loading={login.isPending}>
        {t('signIn')}
      </Button>
    </form>
  );
}
