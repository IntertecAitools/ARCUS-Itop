'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CircleCheckBig, Lock, RefreshCw, UserCheck } from 'lucide-react';
import { Stepper } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { Button } from '@/components/ui';
import { routes } from '@/config';
import { formatDateTime } from '@/lib/utils';
import { PROBLEM_STATUSES } from '../schemas';
import type { Problem, ProblemStimulus, ProblemTransition } from '../types';
import { ProblemPriorityBadge, ProblemStatusPill } from './ProblemBadges';

const stimulusIcons: Record<ProblemStimulus, typeof UserCheck> = {
  ev_assign: UserCheck,
  ev_reassign: RefreshCw,
  ev_resolve: CircleCheckBig,
  ev_close: Lock,
};

/** Buttons for the stimuli iTop allows in the current state (from /transitions). */
export function ProblemActions({
  transitions,
  loading,
  onSelect,
}: {
  transitions: ProblemTransition[];
  loading?: boolean;
  onSelect: (transition: ProblemTransition) => void;
}) {
  const { t } = useTranslation('problems');
  if (loading) return <Skeleton className="h-10 w-48" />;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('detail.actions')}>
      {transitions.map((tr, index) => {
        const Icon = stimulusIcons[tr.stimulus];
        return (
          <Button
            key={tr.stimulus}
            variant={index === transitions.length - 1 ? 'primary' : 'secondary'}
            leftIcon={<Icon className="size-4" aria-hidden />}
            onClick={() => onSelect(tr)}
          >
            {t(`stimulus.${tr.stimulus}`)}
          </Button>
        );
      })}
    </div>
  );
}

export function ProblemHeader({ problem, actions }: { problem: Problem; actions?: ReactNode }) {
  const { t } = useTranslation('problems');
  const meta: Array<[string, string | null]> = [
    [t('fields.org_id'), problem.org_name],
    [t('fields.caller_id'), problem.caller_name],
    [t('detail.assignedTo'), [problem.team_name, problem.agent_name].filter(Boolean).join(' · ') || null],
    [t('fields.start_date'), formatDateTime(problem.start_date)],
    [t('fields.last_update'), formatDateTime(problem.last_update)],
  ];

  return (
    <div className="mb-6 space-y-5">
      <Link href={routes.problems.list()} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {t('detail.backToList')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-muted">{problem.ref}</span>
            <ProblemPriorityBadge priority={problem.priority} />
            <ProblemStatusPill status={problem.status} />
          </div>
          <h1 className="text-[28px] leading-9 font-bold tracking-tight text-text">{problem.title}</h1>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {meta.map(([label, value]) => (
              <div key={label} className="flex gap-1.5">
                <dt className="text-text-muted">{label}:</dt>
                <dd className="font-medium text-text">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
        {actions}
      </div>
      <div className="rounded-card border border-border bg-surface px-5 py-4 shadow-card">
        <Stepper
          label={t('detail.lifecycle')}
          currentId={problem.status}
          steps={PROBLEM_STATUSES.map((s) => ({ id: s, label: t(`status.${s}`) }))}
        />
      </div>
    </div>
  );
}
