import { useState } from 'react';
import { Button, Card, CardBody } from '@/components/ui';
import { useUpdateRecord } from '../api/useRecords';
import type { ClassInfo, RecordDto } from '../types';
import { CONTROL, FieldValue } from './FieldControls';

/**
 * A case log (public log, private log): its entries, plus a box to add one.
 *
 * iTop appends whatever string is written to a CaseLog attribute as a new
 * entry stamped with the user and the time, so adding an entry is an
 * ordinary update of that attribute. Older entries are never edited.
 */
export function CaseLogTab({
  info,
  record,
  attcode,
}: {
  info: ClassInfo;
  record: RecordDto;
  attcode: string;
}) {
  const update = useUpdateRecord(info.name, String(record.id));
  const [text, setText] = useState('');
  const writable = info.writable.includes(attcode);

  const submit = () => {
    const entry = text.trim();
    if (!entry) return;
    update.mutate({ [attcode]: entry }, { onSuccess: () => setText('') });
  };

  return (
    <Card>
      <CardBody>
        {writable ? (
          <div className="mb-4">
            <label htmlFor={`log-${attcode}`} className="sr-only">
              New entry
            </label>
            <textarea
              id={`log-${attcode}`}
              rows={3}
              className={CONTROL}
              placeholder="Add an entry…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {update.isError ? (
              <p role="alert" className="mt-1 text-[12px] text-critical-ink">
                {update.error instanceof Error ? update.error.message : 'The entry could not be added.'}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={submit} loading={update.isPending} disabled={!text.trim()}>
                Add entry
              </Button>
            </div>
          </div>
        ) : null}
        <FieldValue spec={info.fields[attcode]!} value={record.fields[attcode]} />
      </CardBody>
    </Card>
  );
}
