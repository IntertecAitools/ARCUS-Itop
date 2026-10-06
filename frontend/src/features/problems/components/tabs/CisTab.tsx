'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Trash2 } from 'lucide-react';
import { Card, DataTable, type DataTableColumn } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Badge, Button } from '@/components/ui';
import { CiSelect, type LinkedCi } from '@/features/cmdb';
import { toast } from '@/stores';
import type { LookupOption } from '@/types';
import { useProblemLink } from '../../api/problems';
import type { Problem } from '../../types';

export function CisTab({ problem, canEdit }: { problem: Problem; canEdit: boolean }) {
  const { t } = useTranslation('problems');
  const { link, unlink } = useProblemLink(problem.id, 'cis');
  const [selected, setSelected] = useState<LookupOption | null>(null);

  async function onLink() {
    if (!selected) return;
    try {
      await link.mutateAsync(selected.id);
      toast.success(t('cis.linked', { name: selected.label }));
      setSelected(null);
    } catch {
      // reported by the global toast
    }
  }

  const columns: DataTableColumn<LinkedCi>[] = [
    { id: 'name', header: t('cis.name'), cell: (r) => <span className="font-medium">{r.functionalci_name}</span> },
    { id: 'class', header: t('cis.class'), cell: (r) => r.functionalci_class },
    {
      id: 'impact',
      header: t('cis.impact'),
      cell: (r) => <Badge tone={r.impact_code === 'manual' ? 'info' : 'neutral'}>{t(`cis.impactCode.${r.impact_code}`)}</Badge>,
    },
  ];
  if (canEdit) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      className: 'w-16 text-right',
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('cis.remove', { name: r.functionalci_name })}
          onClick={() => unlink.mutate(r.functionalci_id)}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ),
    });
  }

  return (
    <Card title={t('cis.title')}>
      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1">
            <label htmlFor="link-ci" className="mb-1.5 block text-sm font-medium text-text">
              {t('cis.pickerLabel')}
            </label>
            <CiSelect
              id="link-ci"
              value={selected}
              onChange={setSelected}
              excludeIds={problem.functionalcis_list.map((c) => c.functionalci_id)}
            />
          </div>
          <Button onClick={onLink} disabled={!selected} loading={link.isPending} leftIcon={<Link2 className="size-4" aria-hidden />}>
            {t('linked.link')}
          </Button>
        </div>
      )}
      <DataTable
        caption={t('cis.title')}
        columns={columns}
        rows={problem.functionalcis_list}
        getRowId={(r) => r.functionalci_id}
        emptyState={<EmptyState title={t('cis.emptyTitle')} description={t('cis.emptyDescription')} />}
      />
    </Card>
  );
}
