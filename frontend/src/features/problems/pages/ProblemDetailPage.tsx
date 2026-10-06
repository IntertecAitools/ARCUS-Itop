'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { Card } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { TabPanel, Tabs, buttonClasses } from '@/components/ui';
import { featureFlags, routes } from '@/config';
import { usePermissions } from '@/features/auth';
import { isNotFound } from '@/lib/api-client';
import { useProblem, useProblemTransitions } from '../api/problems';
import { ProblemActions, ProblemHeader } from '../components/ProblemHeader';
import { TransitionDialog } from '../components/TransitionDialog';
import { ActivityTab } from '../components/tabs/ActivityTab';
import { AttachmentsTab } from '../components/tabs/AttachmentsTab';
import { ChangeTab } from '../components/tabs/ChangeTab';
import { CisTab } from '../components/tabs/CisTab';
import { ContactsTab } from '../components/tabs/ContactsTab';
import { DetailsTab } from '../components/tabs/DetailsTab';
import { KnownErrorsTab } from '../components/tabs/KnownErrorsTab';
import { LinkedTicketsTab } from '../components/tabs/LinkedTicketsTab';
import { PROBLEM_DETAIL_TABS, useDetailTab, type ProblemDetailTab } from '../hooks/useDetailTab';
import { isEditable } from '../schemas';
import type { ProblemTransition } from '../types';

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export function ProblemDetailPage() {
  const { t } = useTranslation('problems');
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const canWrite = can('problem:write');
  const [tab, setTab] = useDetailTab();
  const [transition, setTransition] = useState<ProblemTransition | null>(null);

  const { data: problem, isLoading, error } = useProblem(id);
  const transitions = useProblemTransitions(id, canWrite && !!problem);

  if (isNotFound(error)) {
    return (
      <Card>
        <EmptyState
          icon={SearchX}
          title={t('detail.notFoundTitle')}
          description={t('detail.notFoundDescription', { id })}
          action={
            <Link href={routes.problems.list()} className={buttonClasses('secondary')}>
              {t('detail.backToList')}
            </Link>
          }
        />
      </Card>
    );
  }
  if (error && !problem) {
    return (
      <Card>
        <EmptyState tone="danger" title={t('detail.errorTitle')} description={error.message} />
      </Card>
    );
  }
  if (isLoading || !problem) return <DetailSkeleton />;

  // Closed problems are read-only: no edit, link or transition actions.
  const open = problem.status !== 'closed';
  const canEdit = canWrite && open;
  const counts: Partial<Record<ProblemDetailTab, number>> = {
    incidents: problem.related_incident_list.length,
    requests: problem.related_request_list.length,
    cis: problem.functionalcis_list.length,
    contacts: problem.contacts_list.length,
    'known-errors': problem.knownerrors_list.length,
  };
  const tabs = PROBLEM_DETAIL_TABS.filter((x) => x !== 'attachments' || featureFlags.attachments);

  return (
    <>
      <ProblemHeader
        problem={problem}
        actions={
          canEdit && (
            <ProblemActions transitions={transitions.data ?? []} loading={transitions.isLoading} onSelect={setTransition} />
          )
        }
      />

      <Tabs
        idPrefix="problem"
        label={t('detail.tabsLabel')}
        value={tab}
        onChange={(next) => setTab(next as ProblemDetailTab)}
        items={tabs.map((x) => ({ id: x, label: t(`detail.tabs.${x}`), count: counts[x] }))}
        className="mb-6"
      />

      <TabPanel idPrefix="problem" id={tab}>
        {tab === 'details' && <DetailsTab key={problem.status} problem={problem} canWrite={canEdit} />}
        {tab === 'activity' && <ActivityTab problem={problem} canWrite={canWrite} />}
        {tab === 'incidents' && <LinkedTicketsTab problem={problem} kind="incidents" canEdit={canEdit} />}
        {tab === 'requests' && <LinkedTicketsTab problem={problem} kind="requests" canEdit={canEdit} />}
        {tab === 'cis' && <CisTab problem={problem} canEdit={canEdit} />}
        {tab === 'contacts' && <ContactsTab problem={problem} canEdit={canEdit} />}
        {tab === 'known-errors' && <KnownErrorsTab problem={problem} canCreate={can('knownerror:write')} />}
        {tab === 'change' && (
          <ChangeTab problem={problem} canEdit={canWrite && isEditable(problem.status, 'related_change_id')} />
        )}
        {tab === 'attachments' && <AttachmentsTab problem={problem} canEdit={canEdit} />}
      </TabPanel>

      <TransitionDialog problem={problem} transition={transition} onClose={() => setTransition(null)} />
    </>
  );
}
