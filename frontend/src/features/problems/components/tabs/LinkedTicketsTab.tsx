'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { Card } from '@/components/data-display';
import { ConfirmDialog } from '@/components/overlays';
import { Button } from '@/components/ui';
import { IncidentPicker } from '@/features/incidents';
import { LinkedTicketTable, type LinkedTicket } from '@/features/tickets';
import { UserRequestPicker } from '@/features/user-requests';
import { toast } from '@/stores';
import type { LookupOption } from '@/types';
import { useProblemLink } from '../../api/problems';
import type { Problem } from '../../types';

/** Incidents / UserRequests whose parent_problem_id is this problem. */
export function LinkedTicketsTab({
  problem,
  kind,
  canEdit,
}: {
  problem: Problem;
  kind: 'incidents' | 'requests';
  canEdit: boolean;
}) {
  const { t } = useTranslation('problems');
  const { t: tc } = useTranslation();
  const { link, unlink } = useProblemLink(problem.id, kind);
  const [selected, setSelected] = useState<LookupOption | null>(null);
  const [toUnlink, setToUnlink] = useState<LinkedTicket | null>(null);
  const tickets = kind === 'incidents' ? problem.related_incident_list : problem.related_request_list;
  const Picker = kind === 'incidents' ? IncidentPicker : UserRequestPicker;
  const ns = `linked.${kind}`;

  async function onLink() {
    if (!selected) return;
    try {
      await link.mutateAsync(selected.id);
      toast.success(t(`${ns}.linked`, { ref: selected.label }));
      setSelected(null);
    } catch {
      // reported by the global toast
    }
  }

  async function onConfirmUnlink() {
    if (!toUnlink) return;
    try {
      await unlink.mutateAsync(toUnlink.id);
      toast.success(t(`${ns}.unlinked`, { ref: toUnlink.ref }));
    } catch {
      // reported by the global toast
    }
    setToUnlink(null);
  }

  return (
    <Card title={t(`${ns}.title`)}>
      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1">
            <label htmlFor={`link-${kind}`} className="mb-1.5 block text-sm font-medium text-text">
              {t(`${ns}.pickerLabel`)}
            </label>
            <Picker
              id={`link-${kind}`}
              value={selected}
              onChange={setSelected}
              excludeIds={tickets.map((x) => x.id)}
            />
          </div>
          <Button onClick={onLink} disabled={!selected} loading={link.isPending} leftIcon={<Link2 className="size-4" aria-hidden />}>
            {t('linked.link')}
          </Button>
        </div>
      )}
      <LinkedTicketTable
        caption={t(`${ns}.title`)}
        tickets={tickets}
        emptyTitle={t(`${ns}.emptyTitle`)}
        emptyDescription={t(`${ns}.emptyDescription`)}
        onUnlink={canEdit ? setToUnlink : undefined}
      />
      <ConfirmDialog
        open={!!toUnlink}
        title={t(`${ns}.unlinkTitle`)}
        description={t(`${ns}.unlinkDescription`, { ref: toUnlink?.ref, problem: problem.ref })}
        confirmLabel={t('linked.unlink')}
        cancelLabel={tc('actions.cancel')}
        tone="danger"
        loading={unlink.isPending}
        onConfirm={onConfirmUnlink}
        onCancel={() => setToUnlink(null)}
      />
    </Card>
  );
}
