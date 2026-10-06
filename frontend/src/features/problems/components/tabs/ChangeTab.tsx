'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitPullRequestArrow } from 'lucide-react';
import { Card } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui';
import { ChangeSelect } from '@/features/changes';
import { toast } from '@/stores';
import type { LookupOption } from '@/types';
import { useSetRelatedChange } from '../../api/problems';
import type { Problem } from '../../types';

/** related_change_id: only Changes that are not closed can be selected. */
export function ChangeTab({ problem, canEdit }: { problem: Problem; canEdit: boolean }) {
  const { t } = useTranslation('problems');
  const setChange = useSetRelatedChange(problem.id);
  const current: LookupOption | null = problem.related_change_id
    ? { id: problem.related_change_id, label: problem.related_change_ref ?? problem.related_change_id }
    : null;
  const [selected, setSelected] = useState<LookupOption | null>(current);
  const changed = (selected?.id ?? null) !== (current?.id ?? null);

  async function save(value: LookupOption | null) {
    try {
      await setChange.mutateAsync(value?.id ?? null);
      toast.success(value ? t('change.linked', { ref: value.label }) : t('change.cleared'));
    } catch {
      setSelected(current);
    }
  }

  return (
    <Card title={t('change.title')}>
      {current ? (
        <div className="mb-5 flex items-center gap-3 rounded-control border border-border bg-surface-muted p-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-purple-soft text-purple" aria-hidden>
            <GitPullRequestArrow className="size-5" />
          </span>
          <div>
            <p className="text-sm text-text-muted">{t('change.current')}</p>
            <p className="font-semibold text-text">{current.label}</p>
          </div>
        </div>
      ) : (
        <EmptyState icon={GitPullRequestArrow} title={t('change.emptyTitle')} description={t('change.emptyDescription')} className="py-6" />
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1">
            <label htmlFor="related-change" className="mb-1.5 block text-sm font-medium text-text">
              {t('change.pickerLabel')}
            </label>
            <ChangeSelect id="related-change" value={selected} onChange={setSelected} />
          </div>
          <Button onClick={() => save(selected)} disabled={!changed} loading={setChange.isPending}>
            {t('change.save')}
          </Button>
          {current && (
            <Button
              variant="secondary"
              onClick={() => {
                setSelected(null);
                void save(null);
              }}
            >
              {t('change.clear')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
