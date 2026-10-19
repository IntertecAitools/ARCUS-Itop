import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X } from 'lucide-react';

import { Button, Card, CardBody, Input, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useClassInfo, useLinkMutations, useOptionSearch, useRelated } from '../api/useRecords';
import type { ClassInfo, RecordDto } from '../types';

/**
 * The objects on the far side of a LinkedSet, with iTop's add and remove.
 *
 * iTop renders these as tabs on a record — the CIs a problem affects, the
 * contacts on a ticket. Two shapes hide behind them:
 *
 *  - n-n (LinkedSetIndirect): rows of a link class (lnkContactToTicket). Each
 *    row is shown as the far object it points at, which is what a person
 *    means by "the contacts"; removing deletes the link row only.
 *  - 1-n (LinkedSet): the far objects themselves (a problem's incidents).
 *    Adding points one at this record; removing clears its key.
 *
 * What may be edited follows the datamodel's edit_mode, as in the console.
 */
export function RelatedTab({
  info,
  id,
  attcode,
}: {
  info: ClassInfo;
  id: string;
  attcode: string;
}) {
  const spec = info.fields[attcode];
  const indirect = spec?.type === 'LinkedSetIndirect' && Boolean(spec.remoteKey);
  const remoteKey = indirect ? spec!.remoteKey! : undefined;

  // For n-n rows, ask for the far object's id and name along with the link row.
  const fields = remoteKey ? `${remoteKey},${remoteKey}_friendlyname` : undefined;
  const { data, isLoading, isError, error } = useRelated(info.name, id, attcode, fields);
  const { data: linkInfo } = useClassInfo(indirect ? (spec?.linked ?? '') : '');
  const remoteClass = remoteKey ? linkInfo?.fields[remoteKey]?.target : spec?.linked;

  const { add, remove } = useLinkMutations(info.name, id, attcode);
  const [adding, setAdding] = useState(false);

  const mode = spec?.editMode ?? 'actions';
  const linkable = Boolean(spec?.linked) && mode !== 'none' && (!spec?.type.endsWith('Indirect') || indirect);
  const removable = linkable && mode !== 'add_only';

  // iTop's wording for the tab. The underlying class is often a link table,
  // which is an implementation detail and reads as noise.
  const label = info.labels?.fields?.[attcode];
  const mutationError = (add.error ?? remove.error) as Error | null;

  if (isLoading) return <Skeleton className="h-40" />;

  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
      >
        Couldn’t load these related records. {error instanceof Error ? error.message : ''}
      </div>
    );
  }

  const rows = data?.items ?? [];

  return (
    <Card>
      <CardBody>
        {linkable ? (
          <div className="mb-3 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus className="size-4" />}
              onClick={() => setAdding((a) => !a)}
            >
              {adding ? 'Done' : 'Add'}
            </Button>
          </div>
        ) : null}

        {mutationError ? (
          <div
            role="alert"
            className="mb-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
          >
            {mutationError.message}
          </div>
        ) : null}

        {adding && remoteClass ? (
          <LinkPicker
            target={remoteKey ? { className: spec!.linked!, attcode: remoteKey } : { className: remoteClass }}
            exclude={new Set(rows.map((r) => farId(r, remoteKey)))}
            pending={add.isPending}
            onPick={(targetId) => add.mutate(targetId)}
          />
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing linked yet"
            description={label ? `This record has no ${label.toLowerCase()} yet.` : 'No records are linked here.'}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const far = farId(row, remoteKey);
              const farLabel = remoteKey
                ? String(row.fields[`${remoteKey}_friendlyname`] ?? '') || row.label
                : row.label;
              const targetClass = remoteKey ? remoteClass : row.class;
              return (
                <li key={`${row.class}-${row.id}`} className="flex items-center gap-2 py-2 text-[13px]">
                  {targetClass && far > 0 ? (
                    <Link to={`/records/${targetClass}/${far}`} className="text-brand-ink hover:underline">
                      {farLabel || `${targetClass} #${far}`}
                    </Link>
                  ) : (
                    <span className="text-ink">{farLabel || `#${row.id}`}</span>
                  )}
                  <span className="font-mono text-[11px] text-ink-muted">{targetClass ?? row.class}</span>
                  {removable ? (
                    <button
                      type="button"
                      aria-label={`Remove ${farLabel}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(row.id)}
                      className="ml-auto rounded-control p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-critical-ink"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {data?.hasMore ? (
          <p className="mt-2 text-[12px] text-ink-muted">
            Showing {rows.length} of {data.total}.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** The far object's id: the remote key on an n-n link row, the row itself on 1-n. */
function farId(row: RecordDto, remoteKey?: string) {
  return remoteKey ? Number(row.fields[remoteKey] ?? 0) : row.id;
}

/** Search box plus results, each with an Add button. */
function LinkPicker({
  target,
  exclude,
  pending,
  onPick,
}: {
  target: { className: string; attcode?: string };
  exclude: Set<number>;
  pending: boolean;
  onPick: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useOptionSearch(target, q.trim());
  const options = (data?.options ?? []).filter((o) => !exclude.has(o.id));

  return (
    <div className="mb-4 rounded-card border border-line p-3">
      <Input
        autoFocus
        placeholder="Search records to add…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-2 max-h-60 divide-y divide-line overflow-y-auto">
        {isFetching && options.length === 0 ? (
          <li className="py-2 text-[13px] text-ink-muted">Searching…</li>
        ) : options.length === 0 ? (
          <li className="py-2 text-[13px] text-ink-muted">No matching records.</li>
        ) : (
          options.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-1.5 text-[13px]">
              <span className="text-ink">{o.label}</span>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => onPick(o.id)}>
                Add
              </Button>
            </li>
          ))
        )}
      </ul>
      {data?.truncated ? (
        <p className="mt-1 text-[12px] text-ink-muted">More match — refine the search.</p>
      ) : null}
    </div>
  );
}
