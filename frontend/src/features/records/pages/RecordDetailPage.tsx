import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, X } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useClassInfo, useRecord, useUpdateRecord } from '../api/useRecords';
import { FieldInput, FieldValue, humaniseAttcode } from '../components/FieldControls';

/**
 * One record of any class, rendered from the schema.
 *
 * Edits write straight through the BFF to iTop, so a change made here IS the
 * change in the system of record — there is no second step in iTop's console.
 */
export function RecordDetailPage() {
  const { className = '', id = '' } = useParams();
  const { data: info, isLoading: schemaLoading } = useClassInfo(className);
  const { data: record, isLoading, isError, error } = useRecord(className, id);
  const update = useUpdateRecord(className, id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  /** Only writable scalars and pickers can be edited; the rest are display. */
  const editable = useMemo(
    () => (info?.writable ?? []).filter((a) => ['scalar', 'picker'].includes(info?.fields[a]?.ui ?? '')),
    [info],
  );

  const shown = useMemo(() => {
    if (!info || !record) return [];
    // Related sets are tabs in iTop, not values; showing them here would print
    // an object id and tell the reader nothing.
    return Object.keys(record.fields)
      .filter((a) => info.fields[a] && !['related', 'ignored'].includes(info.fields[a].ui))
      .sort();
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
    { label: className, to: `/records/${className}` },
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
              <Link to={`/records/${className}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
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

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={record.label || `${className} #${record.id}`}
        description={`${className} · id ${record.id}`}
        actions={
          <>
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
            <Link to={`/records/${className}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="mr-1.5 size-4" />
              All {className}
            </Link>
          </>
        }
      />

      {update.isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {update.error instanceof Error ? update.error.message : 'Could not save those changes.'}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={editing ? 'Edit fields' : 'Fields'}
          subtitle={editing ? `${editable.length} writable` : `${shown.length} shown`}
          action={
            editing ? (
              <Button size="sm" onClick={save} loading={update.isPending}>
                Save changes
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <dl className="divide-y divide-line">
            {(editing ? editable : shown).map((attcode) => {
              const spec = info.fields[attcode];
              if (!spec) return null;
              return (
                <div
                  key={attcode}
                  className="grid grid-cols-1 gap-1.5 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4"
                >
                  <dt className="text-[12.5px] text-ink-muted">
                    <label htmlFor={`field-${attcode}`}>{humaniseAttcode(attcode)}</label>
                    {spec.required ? <span className="ml-0.5 text-critical">*</span> : null}
                  </dt>
                  <dd className="min-w-0 text-[13px]">
                    {editing ? (
                      <FieldInput
                        className={className}
                        attcode={attcode}
                        spec={spec}
                        value={draft[attcode] ?? ''}
                        onChange={(v) => setDraft((d) => ({ ...d, [attcode]: v }))}
                      />
                    ) : (
                      <FieldValue spec={spec} value={record.fields[attcode]} />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
