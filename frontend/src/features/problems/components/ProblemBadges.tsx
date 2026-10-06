'use client';

import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/components/data-display';
import { PriorityBadge } from '@/features/tickets';
import { previewPriority, problemStatusTone } from '../schemas';
import type { ProblemStatus } from '../types';

export function ProblemStatusPill({ status }: { status: ProblemStatus }) {
  const { t } = useTranslation('problems');
  return <StatusPill tone={problemStatusTone(status)} label={t(`status.${status}`)} />;
}

export { PriorityBadge as ProblemPriorityBadge };

/** Live preview of the priority iTop will compute from impact × urgency. */
export function PriorityPreview({ impact, urgency }: { impact?: string | null; urgency?: string | null }) {
  const { t } = useTranslation('problems');
  const priority = previewPriority(impact, urgency);
  return (
    <div className="flex min-h-10 items-center gap-3 rounded-control border border-dashed border-border px-3 py-2" aria-live="polite">
      {priority ? <PriorityBadge priority={priority} /> : <span className="text-sm text-text-muted">—</span>}
      <span className="text-xs text-text-muted">{t('priorityPreviewHint')}</span>
    </div>
  );
}
