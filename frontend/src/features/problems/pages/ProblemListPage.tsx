'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Card } from '@/components/data-display';
import { PageHeader } from '@/components/layout';
import { Button, Tabs, buttonClasses } from '@/components/ui';
import { featureFlags, routes } from '@/config';
import { useCurrentUser, usePermissions } from '@/features/auth';
import { downloadCsv, formatDate, formatDateTime, toCsv, toIsoDate } from '@/lib/utils';
import { toast } from '@/stores';
import { fetchProblems, useProblems } from '../api/problems';
import { CreateMenuButton } from '../components/CreateMenuButton';
import { ProblemFilterBar } from '../components/ProblemFilterBar';
import { ProblemTable } from '../components/ProblemTable';
import { useProblemFilters } from '../hooks/useProblemFilters';
import { PROBLEM_LIST_TABS, toProblemListQuery } from '../schemas';
import type { ProblemListTab, ProblemSummary } from '../types';

const EXPORT_LIMIT = 1000;

export function ProblemListPage() {
  const { t } = useTranslation('problems');
  const user = useCurrentUser();
  const { can } = usePermissions();
  const { filters, setFilters, resetFilters } = useProblemFilters();
  const query = toProblemListQuery(filters, user?.personId);
  const { data, isLoading, isFetching } = useProblems(query);
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await fetchProblems({ ...query, page: 1, pageSize: EXPORT_LIMIT });
      const csv = toCsv<ProblemSummary>(all.items, [
        { header: t('fields.ref'), value: (r) => r.ref },
        { header: t('fields.title'), value: (r) => r.title },
        { header: t('fields.org_id'), value: (r) => r.org_name },
        { header: t('fields.service_id'), value: (r) => r.service_name },
        { header: t('fields.priority'), value: (r) => t(`priority.${r.priority}`) },
        { header: t('fields.status'), value: (r) => t(`status.${r.status}`) },
        { header: t('fields.team_id'), value: (r) => r.team_name },
        { header: t('fields.agent_id'), value: (r) => r.agent_name },
        { header: t('columns.created'), value: (r) => formatDate(r.start_date) },
        { header: t('fields.last_update'), value: (r) => formatDateTime(r.last_update) },
      ]);
      downloadCsv(`problems-${toIsoDate(new Date())}.csv`, csv);
      if (all.total > EXPORT_LIMIT) toast.warning(t('list.exportTruncated', { count: EXPORT_LIMIT }));
    } catch {
      // reported by the global toast
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader title={t('list.title')} subtitle={t('list.subtitle')} actions={<CreateMenuButton />} />
      <Card bodyClassName="space-y-4 pt-0" className="pt-2">
        <Tabs
          idPrefix="problem-list"
          label={t('list.tabsLabel')}
          value={filters.tab}
          onChange={(tab) => setFilters({ tab: tab as ProblemListTab, agentId: tab === 'mine' ? undefined : filters.agentId })}
          items={PROBLEM_LIST_TABS.map((tab) => ({ id: tab, label: t(`list.tabs.${tab}`) }))}
        />
        <div role="tabpanel" id={`problem-list-panel-${filters.tab}`} aria-labelledby={`problem-list-tab-${filters.tab}`} className="space-y-4">
          <ProblemFilterBar filters={filters} onChange={setFilters} onReset={resetFilters} />
          <ProblemTable
            rows={data?.items ?? []}
            loading={isLoading}
            sort={filters.sort}
            onSortChange={(sort) => setFilters({ sort })}
            pagination={{
              page: filters.page,
              pageSize: filters.pageSize,
              total: data?.total ?? 0,
              onPageChange: (page) => setFilters({ page }),
              onPageSizeChange: (pageSize) => setFilters({ pageSize }),
            }}
            toolbar={
              <>
                {isFetching && !isLoading && <span className="text-xs text-text-muted">{t('list.refreshing')}</span>}
                {featureFlags.csvExport && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={exporting}
                    leftIcon={<Download className="size-4" aria-hidden />}
                    onClick={exportCsv}
                    disabled={!data?.total}
                  >
                    {t('list.exportCsv')}
                  </Button>
                )}
              </>
            }
            emptyAction={
              can('problem:write') && filters.tab === 'all' ? (
                <Link href={routes.problems.new} className={buttonClasses('primary', 'sm')}>
                  {t('create.problem')}
                </Link>
              ) : undefined
            }
          />
        </div>
      </Card>
    </>
  );
}
