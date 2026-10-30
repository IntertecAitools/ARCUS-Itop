import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDeleteDraft, useDraft, useSaveDraft } from '../api/useTicketHandling';
import type { DraftKind } from '../types';

export interface TicketDraftState {
  kind: DraftKind;
  /** The draft this form is editing, from `?draft=` once saved or resumed. */
  draftId: string | null;
  save: () => void;
  saving: boolean;
  savedAt: string | null;
  error: unknown;
  /** Deletes the draft (after the ticket was raised from it). */
  discard: () => void;
}

/**
 * A new-ticket form's server-side draft. The draft id lives in the URL
 * (`?draft=…`), so a resumed draft survives a reload and "My drafts" can
 * link straight to it; `onResume` fills the form once the draft is read.
 */
export function useTicketDraft(
  kind: DraftKind,
  values: () => Record<string, unknown>,
  onResume: (data: Record<string, unknown>) => void,
): TicketDraftState {
  const [params, setParams] = useSearchParams();
  const draftId = params.get('draft');
  const { data: draft } = useDraft(draftId);
  const save = useSaveDraft();
  const remove = useDeleteDraft();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const resumed = useRef<string | null>(null);
  const resume = useRef(onResume);
  resume.current = onResume;

  useEffect(() => {
    if (draft && draft.kind === kind && resumed.current !== draft.id) {
      resumed.current = draft.id;
      resume.current(draft.data);
      setSavedAt(draft.updatedAt);
    }
  }, [draft, kind]);

  return {
    kind,
    draftId,
    save: () =>
      save.mutate(
        { ...(draftId ? { id: draftId } : {}), kind, data: values() },
        {
          onSuccess: (saved) => {
            // Already in the form: do not "resume" what was just saved.
            resumed.current = saved.id;
            setSavedAt(saved.updatedAt);
            if (saved.id !== draftId) {
              setParams((p) => {
                p.set('draft', saved.id);
                return p;
              }, { replace: true });
            }
          },
        },
      ),
    saving: save.isPending,
    savedAt,
    error: save.error,
    discard: () => {
      if (draftId) remove.mutate(draftId);
    },
  };
}
