'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Card } from '@/components/data-display';
import { Modal } from '@/components/overlays';
import { Button } from '@/components/ui';
import { KedbSearch, KnownErrorForm, KnownErrorTable, useCreateKnownError } from '@/features/knowledge-base';
import { toast } from '@/stores';
import type { Problem } from '../../types';

/** Known Errors with problem_id = this problem. Add-only, as in iTop. */
export function KnownErrorsTab({ problem, canCreate }: { problem: Problem; canCreate: boolean }) {
  const { t } = useTranslation('problems');
  const create = useCreateKnownError();
  const [open, setOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card
        title={t('knownErrors.title')}
        className="xl:col-span-2"
        actions={
          canCreate && (
            <Button size="sm" leftIcon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
              {t('knownErrors.new')}
            </Button>
          )
        }
      >
        <KnownErrorTable
          rows={problem.knownerrors_list}
          hideProblem
          emptyTitle={t('knownErrors.emptyTitle')}
          emptyDescription={t('knownErrors.emptyDescription')}
        />
      </Card>
      <Card title={t('knownErrors.searchTitle')} className="self-start">
        <KedbSearch id="problem-kedb" defaultQuery={problem.service_name ?? ''} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={t('knownErrors.new')} description={problem.ref} size="lg">
        <KnownErrorForm
          idPrefix="pke"
          lockProblem
          defaultValues={{
            name: problem.title,
            org: { id: problem.org_id, label: problem.org_name },
            problem: { id: problem.id, label: problem.ref },
            cis: problem.functionalcis_list.map((c) => ({
              ci: { id: c.functionalci_id, label: c.functionalci_name },
              reason: '',
            })),
          }}
          submitLabel={t('knownErrors.create')}
          onCancel={() => setOpen(false)}
          onSubmit={async (input) => {
            const created = await create.mutateAsync(input);
            toast.success(t('knownErrors.created', { name: created.name }));
            setOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}
