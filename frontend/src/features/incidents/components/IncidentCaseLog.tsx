import { useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { Avatar, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useAddLogEntry } from '../api/useIncidents';
import { toPlainText } from '../lib/itop-text';
import type { CaseLogEntry } from '../types';

export function IncidentCaseLog({ id, entries }: { id: string; entries: CaseLogEntry[] }) {
  const [message, setMessage] = useState('');
  const addEntry = useAddLogEntry(id);

  const submit = () => {
    const text = message.trim();
    if (!text) return;
    addEntry.mutate(text, { onSuccess: () => setMessage('') });
  };

  return (
    <Card>
      <CardHeader title="Activity" subtitle={`${entries.length} public ${entries.length === 1 ? 'entry' : 'entries'}`} />
      <CardBody className="space-y-4">
        {entries.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={<MessageSquare className="size-5" />}
            title="Nothing logged yet"
            description="Updates you post here are visible to the caller."
          />
        ) : (
          <ol className="space-y-4">
            {entries.map((entry, index) => (
              <li key={`${entry.date}-${index}`} className="flex gap-3">
                <Avatar name={entry.author || 'System'} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-ink">
                      {entry.author || 'System'}
                    </span>
                    {entry.date ? (
                      <span className="text-[11px] text-ink-muted tabular-nums">{entry.date}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-secondary">
                    {toPlainText(entry.message)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="border-t border-line pt-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Add an update for the caller…"
            aria-label="New activity entry"
            className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40"
          />

          {addEntry.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-critical-ink">
              {addEntry.error instanceof Error ? addEntry.error.message : 'Could not post that.'}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={submit}
              disabled={!message.trim()}
              loading={addEntry.isPending}
              leadingIcon={<Send className="size-4" />}
            >
              Post update
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
