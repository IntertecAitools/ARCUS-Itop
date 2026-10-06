'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout';
import { CreateMenuButton } from '../components/CreateMenuButton';
import {
  MyProblemsCard,
  PriorityDonutCard,
  ProblemKpis,
  ProblemsTrendCard,
  RecentProblemsCard,
  TopServicesCard,
} from '../components/DashboardWidgets';
import type { StatsRange } from '../types';

export function ProblemsDashboardPage() {
  const { t } = useTranslation('problems');
  const [range, setRange] = useState<StatsRange>('7d');

  return (
    <>
      <PageHeader
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        showDate
        actions={<CreateMenuButton />}
      />
      <div className="space-y-6">
        <ProblemKpis />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ProblemsTrendCard range={range} onRangeChange={setRange} />
          </div>
          <PriorityDonutCard range={range} />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <RecentProblemsCard />
          </div>
          <MyProblemsCard />
          <TopServicesCard range={range} />
        </div>
      </div>
    </>
  );
}
