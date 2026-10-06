'use client';

import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout';
import { useCurrentUser } from '@/features/auth';
import { CreateMenuButton, MyProblemsCard, ProblemKpis, RecentProblemsCard } from '@/features/problems';

/** Agent home. Only the Problem module exists so far, so it shows its widgets. */
export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const user = useCurrentUser();
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={user?.name ?? t('title')}
        subtitle={t('subtitle')}
        showDate
        actions={<CreateMenuButton />}
      />
      <div className="space-y-6">
        <ProblemKpis />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <RecentProblemsCard />
          </div>
          <MyProblemsCard />
        </div>
      </div>
    </>
  );
}
