'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { buttonClasses } from '@/components/ui';
import { routes } from '@/config/routes';
import { usePermissions, type Permission } from '@/features/auth';

/** Shows a "no access" state instead of the page when the user lacks the permission. */
export function RequireRole({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { t } = useTranslation();
  const { can } = usePermissions();
  if (!permission || can(permission)) return <>{children}</>;
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <EmptyState
        icon={Lock}
        tone="danger"
        title={t('access.deniedTitle')}
        description={t('access.deniedDescription')}
        action={
          <Link href={routes.problems.dashboard} className={buttonClasses('secondary')}>
            {t('access.back')}
          </Link>
        }
      />
    </div>
  );
}
