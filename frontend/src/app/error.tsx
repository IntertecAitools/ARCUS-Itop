'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <EmptyState
        icon={CircleAlert}
        tone="danger"
        title={t('errors.pageTitle')}
        description={error.message}
        action={<Button onClick={reset}>{t('actions.retry')}</Button>}
      />
    </div>
  );
}
