import { Clock, FileText, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KpiCard, type KpiTone } from '@/components/data-display';
import { SkeletonCard } from '@/components/ui';
import { percent } from '@/lib/utils';
import type { KpiKey, KpiSummary } from '../types';

const RANGE_LABEL: Record<string, string> = {
  '24h': 'dashboard.compared.24h',
  '7d': 'dashboard.compared.7d',
  '30d': 'dashboard.compared.30d',
  '90d': 'dashboard.compared.90d',
};

interface KpiRowProps {
  kpis?: KpiSummary;
  range: string;
  isLoading: boolean;
}

export function KpiRow({ kpis, range, isLoading }: KpiRowProps) {
  const { t } = useTranslation();
  const comparedTo = t(RANGE_LABEL[range] ?? 'dashboard.compared.other');

  if (isLoading || !kpis) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[116px]" />
        ))}
      </div>
    );
  }

  const tiles: Array<{
    label: string;
    value: string;
    icon: React.ReactNode;
    tone: KpiTone;
    deltaKey: KpiKey;
  }> = [
    {
      label: t('dashboard.kpi.totalIncidents'),
      value: String(kpis.totalIncidents),
      icon: <FileText className="size-5" />,
      tone: 'brand',
      deltaKey: 'totalIncidents',
    },
    {
      label: t('dashboard.kpi.openIncidents'),
      value: String(kpis.openIncidents),
      icon: <TriangleAlert className="size-5" />,
      tone: 'critical',
      deltaKey: 'openIncidents',
    },
    {
      label: t('dashboard.kpi.slaBreached'),
      value: String(kpis.slaBreached),
      icon: <Clock className="size-5" />,
      tone: 'warning',
      deltaKey: 'slaBreached',
    },
    {
      label: t('dashboard.kpi.slaCompliance'),
      // An em dash, not 0% — nothing under SLA is "no measurement", not "failed".
      value: kpis.slaCompliance === null ? '—' : percent(kpis.slaCompliance),
      icon: <ShieldCheck className="size-5" />,
      tone: 'good',
      deltaKey: 'slaCompliance',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => {
        // No baseline means no delta — showing "0%" would read as "unchanged"
        // when the truth is "we don't know yet".
        const delta = kpis.deltas?.[tile.deltaKey];
        const trend = kpis.sparklines?.[tile.deltaKey];

        return (
          <KpiCard
            key={tile.deltaKey}
            label={tile.label}
            value={tile.value}
            icon={tile.icon}
            tone={tile.tone}
            delta={delta ? { ...delta, comparedTo } : undefined}
            trend={trend}
          />
        );
      })}
    </div>
  );
}
