'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Trash2 } from 'lucide-react';
import { Card, DataTable, type DataTableColumn } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Badge, Button } from '@/components/ui';
import { PersonSelect, type LinkedContact } from '@/features/contacts';
import { toast } from '@/stores';
import type { LookupOption } from '@/types';
import { useProblemLink } from '../../api/problems';
import type { Problem } from '../../types';

export function ContactsTab({ problem, canEdit }: { problem: Problem; canEdit: boolean }) {
  const { t } = useTranslation('problems');
  const { link, unlink } = useProblemLink(problem.id, 'contacts');
  const [selected, setSelected] = useState<LookupOption | null>(null);

  async function onLink() {
    if (!selected) return;
    try {
      await link.mutateAsync(selected.id);
      toast.success(t('contacts.linked', { name: selected.label }));
      setSelected(null);
    } catch {
      // reported by the global toast
    }
  }

  const columns: DataTableColumn<LinkedContact>[] = [
    { id: 'name', header: t('contacts.name'), cell: (r) => <span className="font-medium">{r.contact_name}</span> },
    { id: 'email', header: t('contacts.email'), cell: (r) => r.contact_email || '—' },
    {
      id: 'role',
      header: t('contacts.role'),
      cell: (r) => <Badge tone={r.role_code === 'manual' ? 'info' : 'neutral'}>{t(`contacts.roleCode.${r.role_code}`)}</Badge>,
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
          aria-label={t('contacts.remove', { name: r.contact_name })}
          onClick={() => unlink.mutate(r.contact_id)}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ),
    });
  }

  return (
    <Card title={t('contacts.title')}>
      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1">
            <label htmlFor="link-contact" className="mb-1.5 block text-sm font-medium text-text">
              {t('contacts.pickerLabel')}
            </label>
            <PersonSelect
              id="link-contact"
              value={selected}
              onChange={setSelected}
              excludeIds={problem.contacts_list.map((c) => c.contact_id)}
            />
          </div>
          <Button onClick={onLink} disabled={!selected} loading={link.isPending} leftIcon={<Link2 className="size-4" aria-hidden />}>
            {t('linked.link')}
          </Button>
        </div>
      )}
      <DataTable
        caption={t('contacts.title')}
        columns={columns}
        rows={problem.contacts_list}
        getRowId={(r) => r.contact_id}
        emptyState={<EmptyState title={t('contacts.emptyTitle')} description={t('contacts.emptyDescription')} />}
      />
    </Card>
  );
}
