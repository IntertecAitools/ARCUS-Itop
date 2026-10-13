import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, X } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { AttachmentsPanel } from '@/features/attachments';
import { useApplyStimulus, useClassInfo, useRecord, useUpdateRecord } from '../api/useRecords';
import { fieldLabel, layoutFor, RecordForm } from '../components/RecordForm';
import { RelatedTab } from '../components/RelatedTab';

/**
 * One record of any class, laid out the way iTop lays it out.
 *
 * Three things come from the schema rather than from this file: the fieldsets
 * and their order, the labels, and the lifecycle actions. That is what makes
 * one screen stand in for 136 classes without any of them looking generic.
 *
 * Edits write straight through the BFF to iTop, so a change made here IS the
 * change in the system of record — there is no second step in iTop's console.
 */
export function RecordDetailPage() {
  const { className = '', id = '' } = useParams();
  const { data: info, isLoading: schemaLoading } = useClassInfo(className);
  const { data: record, isLoading, isError, error } = useRecord(className, id);
  const update = useUpdateRecord(className, id);
  const stimulus = useApplyStimulus(className, id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<string>('details');

  /** Only writable scalars and pickers can be edited; the rest are display. */
  const editable = useMemo(
    () =>
      (info?.writable ?? []).filter((a) =>
        ['scalar', 'picker'].includes(info?.fields[a]?.ui ?? ''),
      ),
    [info],
  );

  const editableSet = useMemo(() => new Set(editable), [editable]);

  const fieldsets = useMemo(() => {
    if (!info) return [];
    if (editing) return layoutFor(info, (code) => editableSet.has(code));
    // Related sets are tabs, not values: rendering one inline would print an
    // object id and tell the reader nothing.
    return layoutFor(
      info,
      (code) =>
        Boolean(record?.fields && code in record.fields) &&
        !['related', 'ignored'].includes(info.fields[code]?.ui ?? ''),
    );
  }, [info, record, editing, editableSet]);

  /** LinkedSet attributes iTop shows as tabs, keeping iTop's order. */
  const relatedTabs = useMemo(() => {
    if (!info) return [];
    const declared = info.presentation?.related ?? [];
    const rest = info.related.filter((code) => !declared.includes(code));
    return [...declared, ...rest].filter((code) => info.fields[code]?.linkedAvailable !== false);
  }, [info]);

  /**
   * The actions available right now.
   *
   * iTop declares transitions per state, so the record's current state decides
   * what can be applied. Offering every stimulus would show buttons that
   * always fail.
   */
  const actions = useMemo(() => {
    if (!info?.lifecycle || !record) return [];
    const state = String(record.fields[info.lifecycle.attribute] ?? '');
    return info.lifecycle.states[state] ?? [];
  }, [info, record]);

  // Reset the draft whenever the record reloads, so a stale edit cannot be
  // submitted over someone else's change.
  useEffect(() => {
    if (!record) return;
    const next: Record<string, string> = {};
    for (const a of editable) {
      const v = record.fields[a];
      next[a] = v === null || v === undefined ? '' : String(v);
    }
    setDraft(next);
  }, [record, editable]);

  const save = () => {
    if (!record) return;
    // Send only what changed: a full payload would rewrite untouched fields
    // and bury the real edit in iTop's change history.
    const patch: Record<string, unknown> = {};
    for (const a of editable) {
      const original = record.fields[a];
      const originalText = original === null || original === undefined ? '' : String(original);
      if (draft[a] !== originalText) patch[a] = draft[a];
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    update.mutate(patch, { onSuccess: () => setEditing(false) });
  };

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Records', to: '/records' },
    { label: info?.labels?.class ?? className, to: `/records/${className}` },
    { label: `#${id}` },
  ];

  if (isError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Record not found" />
        <Card>
          <EmptyState
            title={`No ${className} with id ${id}`}
            description={error instanceof Error ? error.message : undefined}
            action={
              <Link
                to={`/records/${className}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                Back to {className}
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  if (isLoading || schemaLoading || !record || !info) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Loading…" />
        <Skeleton className="h-96" />
      </>
    );
  }

  /**
   * iTop accepts attachments on Ticket and its subclasses (its
   * itop-attachments `allowed_classes`). Attachments are a standalone class
   * joined through item_class/item_id, so they are absent from the
   * presentation metadata and get a tab of their own rather than a fieldset.
   */
  const supportsAttachments = info.name === 'Ticket' || info.inherits.includes('Ticket');

  const tabs = [
    { id: 'details', label: 'Details' },
    ...(supportsAttachments ? [{ id: 'attachments', label: 'Attachments' }] : []),
    ...relatedTabs.map((code) => ({ id: code, label: fieldLabel(info, code) })),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={record.label || `${info.labels.class} #${record.id}`}
        description={`${info.labels.class} · id ${record.id}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* iTop's own actions for the record's current state. */}
            {!editing
              ? actions.map((action) => (
                  <Button
                    key={action}
                    variant="secondary"
                    size="sm"
                    loading={stimulus.isPending && stimulus.variables === action}
                    onClick={() => stimulus.mutate(action)}
                  >
                    {info.labels.stimuli?.[action] ?? action}
                  </Button>
                ))
              : null}
            {editable.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={editing ? <X className="size-4" /> : <Pencil className="size-4" />}
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? 'Cancel' : 'Edit'}
              </Button>
            ) : null}
            {editing ? (
              <Button size="sm" onClick={save} loading={update.isPending}>
                Save changes
              </Button>
            ) : null}
            <Link
              to={`/records/${className}`}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              All {info.labels.class}
            </Link>
          </div>
        }
      />

      {update.isError || stimulus.isError ? (
        <div
          role="alert"
          className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          {(update.error ?? stimulus.error) instanceof Error
            ? (update.error ?? stimulus.error)!.message
            : 'That change could not be saved.'}
        </div>
      ) : null}

      {tabs.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors',
                tab === t.id
                  ? 'border-brand font-medium text-brand-ink'
                  : 'border-transparent text-ink-secondary hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'attachments' ? (
        <AttachmentsPanel className={className} id={id} />
      ) : tab === 'details' ? (
        <RecordForm
          info={info}
          fieldsets={fieldsets}
          editing={editing}
          values={record.fields}
          draft={draft}
          onChange={(attcode, value) => setDraft((d) => ({ ...d, [attcode]: value }))}
        />
      ) : (
        <RelatedTab info={info} id={id} attcode={tab} />
      )}
    </>
  );
}
