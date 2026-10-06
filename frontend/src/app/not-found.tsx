'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { buttonClasses } from '@/components/ui';
import { routes } from '@/config/routes';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <EmptyState
        icon={SearchX}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link href={routes.problems.dashboard} className={buttonClasses('secondary')}>
            {t('notFound.back')}
          </Link>
        }
      />
    </div>
  );
}
