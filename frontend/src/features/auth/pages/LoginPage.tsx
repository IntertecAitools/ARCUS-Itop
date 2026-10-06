'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/layout';
import { env, routes } from '@/config';
import { LoginForm } from '../components/LoginForm';
import { useCurrentUser } from '../hooks/useCurrentUser';

/** Only allow same-app redirects after login */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : routes.problems.dashboard;
}

export function LoginPage() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useCurrentUser();
  const next = safeNext(searchParams.get('next'));

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  return (
    <div className="w-full max-w-md rounded-card border border-border bg-surface p-8 shadow-card">
      <Logo className="mb-6" />
      <h1 className="text-2xl font-bold text-text">{t('title')}</h1>
      <p className="mt-1 mb-6 text-sm text-text-muted">{t('subtitle')}</p>
      <LoginForm onSuccess={() => router.replace(next)} />
      {env.apiMode === 'mock' && (
        <div className="mt-6 rounded-control bg-surface-muted p-3 text-xs text-text-muted">
          <p className="font-semibold text-text">{t('demoTitle')}</p>
          <p>{t('demoManager')}</p>
          <p>{t('demoAgent')}</p>
        </div>
      )}
    </div>
  );
}
