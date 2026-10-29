import { Link } from 'react-router-dom';
import { FilePen, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, IconButton, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { friendlyDateTime } from '@/lib/utils';
import { useDeleteDraft, useDrafts } from '../api/useTicketHandling';
import type { DraftKind } from '../types';

/** Where each kind of draft is resumed. */
export const DRAFT_FORMS: Record<DraftKind, { label: string; path: string }> = {
  incident: { label: 'Incident', path: '/incidents/new' },
  'user-request': { label: 'User request', path: '/records/UserRequest/new' },
  'portal-request': { label: 'Request', path: '/portal/new' },
};

/** The signed-in agent's half-filled new-ticket forms, to resume or throw away. */
export function MyDraftsPage() {
  const { data, isLoading, error } = useDrafts();
  const remove = useDeleteDraft();
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'My drafts' }]}
        title="My drafts"
        description="New tickets you started and saved. Only you see them; nothing is raised until you submit."
      />
      <Card>
        {isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : error ? (
          <p role="alert" className="p-4 text-[13px] text-critical-ink">
            {error instanceof Error ? error.message : 'Could not load your drafts.'}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FilePen className="size-5" />}
            title="No drafts"
            description="Use “Save draft” on a new incident or request to finish it later."
          />
        ) : (
          <ul className="divide-y divide-line" aria-label="Drafts">
            {items.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link to={`${DRAFT_FORMS[d.kind].path}?draft=${d.id}`} className="min-w-0 hover:underline">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{d.title}</span>
                  <span className="block text-[12px] text-ink-muted">
                    {DRAFT_FORMS[d.kind].label} · saved {friendlyDateTime(d.updatedAt)}
                  </span>
                </Link>
                <IconButton
                  label={`Delete draft ${d.title}`}
                  icon={<Trash2 className="size-4" />}
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(d.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
