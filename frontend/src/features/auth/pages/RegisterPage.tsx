import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import { AuthCard, AuthNotice } from '../components/AuthCard';
import { getAuthOptions, register } from '../api/auth.api';

/**
 * Self-registration by email domain: an address at a domain an organisation
 * has claimed gets an account in that organisation. The mailed link sets the
 * password, which is what proves the address; the answer is the same whether
 * or not the address already had an account.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const options = useQuery({ queryKey: ['auth', 'options'], queryFn: getAuthOptions, staleTime: 60_000 });
  const send = useMutation({ mutationFn: register });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() });
  };
  const error = send.error instanceof Error ? send.error.message : null;
  const off = options.data && !options.data.selfRegistration;

  return (
    <AuthCard label={t('auth.register.title')} intro={t('auth.register.lead')} error={error} onSubmit={submit}>
      {send.isSuccess ? (
        <AuthNotice>{send.data.message}</AuthNotice>
      ) : off ? (
        <AuthNotice>{t('auth.register.unavailable')}</AuthNotice>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="reg-first" className="mb-1.5 block text-[13px] font-medium text-ink">
                {t('auth.register.firstName')}
              </label>
              <Input id="reg-first" className="h-11" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="reg-last" className="mb-1.5 block text-[13px] font-medium text-ink">
                {t('auth.register.lastName')}
              </label>
              <Input
                id="reg-last"
                className="h-11"
                autoComplete="family-name"
                required
                aria-required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="reg-email" className="mb-1.5 block text-[13px] font-medium text-ink">
              {t('auth.register.email')}
            </label>
            <Input
              id="reg-email"
              className="h-11"
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              aria-required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="mt-4 h-12 w-full text-[14px]" loading={send.isPending} disabled={!email.trim() || !lastName.trim()}>
            {send.isPending ? t('auth.register.sending') : t('auth.register.submit')}
          </Button>
        </div>
      )}
      <p className="mt-6 text-[14px]">
        <Link to="/login" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
          {t('auth.haveAccount')}
        </Link>
      </p>
    </AuthCard>
  );
}
