'use client';

import { useTranslation } from 'react-i18next';
import { CircleCheckBig, CirclePlus, Lock, MessageSquare, UserCheck } from 'lucide-react';
import { Card, Timeline, type TimelineItem } from '@/components/data-display';
import { CaseLog, CaseLogComposer } from '@/features/tickets';
import { stripHtml } from '@/lib/utils';
import { useAddLogEntry } from '../../api/problems';
import type { Problem } from '../../types';

/** Lifecycle dates + case log entries, newest first */
function buildTimeline(problem: Problem, t: (key: string, o?: Record<string, unknown>) => string): TimelineItem[] {
  const items: TimelineItem[] = [
    { id: 'created', date: problem.start_date, title: t('activity.created'), icon: CirclePlus, tone: 'status-new' },
  ];
  if (problem.assignment_date) {
    items.push({
      id: 'assigned',
      date: problem.assignment_date,
      title: t('activity.assigned'),
      description: [problem.team_name, problem.agent_name].filter(Boolean).join(' · '),
      icon: UserCheck,
      tone: 'purple',
    });
  }
  if (problem.resolution_date) {
    items.push({ id: 'resolved', date: problem.resolution_date, title: t('activity.resolved'), icon: CircleCheckBig, tone: 'success' });
  }
  if (problem.close_date) {
    items.push({ id: 'closed', date: problem.close_date, title: t('activity.closed'), icon: Lock, tone: 'neutral' });
  }
  problem.private_log.forEach((entry, i) => {
    const text = stripHtml(entry.message_html);
    items.push({
      id: `log-${i}`,
      date: entry.date,
      title: t('activity.note', { name: entry.user_name ?? entry.user_login }),
      description: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      icon: MessageSquare,
      tone: 'info',
    });
  });
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

export function ActivityTab({ problem, canWrite }: { problem: Problem; canWrite: boolean }) {
  const { t } = useTranslation('problems');
  const addLog = useAddLogEntry(problem.id);
  // private_log is read-only once the problem is closed
  const canLog = canWrite && problem.status !== 'closed';

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card title={t('activity.caseLog')} className="xl:col-span-2">
        <div className="space-y-6">
          {canLog && <CaseLogComposer id="problem-log" onSubmit={(message) => addLog.mutateAsync(message)} />}
          <CaseLog entries={problem.private_log} />
        </div>
      </Card>
      <Card title={t('activity.timeline')} className="self-start">
        <Timeline label={t('activity.timeline')} items={buildTimeline(problem, t)} />
      </Card>
    </div>
  );
}
