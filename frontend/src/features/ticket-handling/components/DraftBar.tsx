import { Link } from 'react-router-dom';
import { FileClock, Save } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn, friendlyDateTime } from '@/lib/utils';
import { useDrafts } from '../api/useTicketHandling';
import type { TicketDraftState } from '../hooks/useTicketDraft';
import { ErrorLine } from './shared';

/**
 * "Save draft", when it was last saved, and the user's other drafts of this
 * form to pick up instead.
 */
export function DraftBar({ draft, className }: { draft: TicketDraftState; className?: string }) {
  const { data } = useDrafts(draft.kind);
  const others = (data?.items ?? []).filter((d) => d.id !== draft.draftId);

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]', className)}>
      <Button type="button" size="sm" variant="secondary" leadingIcon={<Save className="size-4" />} loading={draft.saving} onClick={draft.save}>
        Save draft
      </Button>
      {draft.savedAt ? <span className="text-ink-muted">Draft saved {friendlyDateTime(draft.savedAt)}</span> : null}
      {others.length > 0 ? (
        <details className="relative">
          <summary className="flex cursor-pointer items-center gap-1 text-brand-ink hover:underline">
            <FileClock className="size-3.5" aria-hidden />
            Your drafts ({others.length})
          </summary>
          <ul className="absolute z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-card border border-line bg-surface-raised py-1 shadow-overlay">
            {others.map((d) => (
              <li key={d.id}>
                <Link to={`?draft=${d.id}`} className="block px-3 py-1.5 hover:bg-surface-hover">
                  <span className="block truncate text-ink">{d.title}</span>
                  <span className="block text-[12px] text-ink-muted">{friendlyDateTime(d.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ErrorLine error={draft.error} />
    </div>
  );
}
