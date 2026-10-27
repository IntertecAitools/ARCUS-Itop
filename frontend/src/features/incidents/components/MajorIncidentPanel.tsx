import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Megaphone, Siren, Unlink } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, IconButton, Input } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import {
  useIncidents,
  useLinkChildIncidents,
  usePostStakeholderUpdate,
  useSetIncidentMajor,
  useUnlinkChildIncident,
} from '../api/useIncidents';
import type { IncidentDetail } from '../types';

const textareaClass =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-critical-ink">
      {error instanceof Error ? error.message : 'That did not work.'}
    </p>
  );
}

/** Finds incidents by ref or summary and links the chosen one as a child. */
function LinkIncidentPicker({ incident }: { incident: IncidentDetail }) {
  const [q, setQ] = useState('');
  const link = useLinkChildIncidents(incident.id);
  const term = q.trim();
  const { data, isFetching } = useIncidents({ page: 1, q: term || undefined });
  const linked = new Set([incident.id, ...(incident.childIncidents ?? []).map((c) => c.id)]);
  const matches = term.length >= 2 ? (data?.items ?? []).filter((i) => !linked.has(i.id)).slice(0, 5) : [];

  return (
    <div className="space-y-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find an incident to link, by ref or summary…"
        aria-label="Find an incident to link"
        leadingIcon={<Link2 className="size-4" />}
      />
      {matches.length > 0 ? (
        <ul className="divide-y divide-line rounded-control border border-line" aria-label="Incidents to link">
          {matches.map((match) => (
            <li key={match.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">{match.ref}</span>{' '}
                <span className="text-ink-secondary">{match.summary}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                loading={link.isPending && link.variables?.[0] === match.id}
                onClick={() => link.mutate([match.id], { onSuccess: () => setQ('') })}
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      ) : term.length >= 2 && !isFetching ? (
        <p className="text-[12.5px] text-ink-muted">No other incident matches.</p>
      ) : null}
      <ErrorLine error={link.error} />
    </div>
  );
}

function StakeholderUpdateForm({ incident }: { incident: IncidentDetail }) {
  const post = usePostStakeholderUpdate(incident.id);
  const [message, setMessage] = useState('');
  const [postToChildren, setPostToChildren] = useState(true);
  const [notifyCallers, setNotifyCallers] = useState(false);
  const [emails, setEmails] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    const notifyEmails = emails
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    post.mutate(
      { message: message.trim(), postToChildren, notifyCallers, ...(notifyEmails.length ? { notifyEmails } : {}) },
      {
        onSuccess: () => {
          setMessage('');
          setEmails('');
        },
      },
    );
  };

  const result = post.data;
  return (
    <form onSubmit={submit} className="space-y-2.5" aria-label="Stakeholder update">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="What changed, what is next, when the next update comes."
        aria-label="Update message"
        className={textareaClass}
      />
      <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <input type="checkbox" checked={postToChildren} onChange={(e) => setPostToChildren(e.target.checked)} />
        Also post it on the linked incidents
      </label>
      <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <input type="checkbox" checked={notifyCallers} onChange={(e) => setNotifyCallers(e.target.checked)} />
        Email the callers
      </label>
      <Input
        value={emails}
        onChange={(e) => setEmails(e.target.value)}
        placeholder="Also email (comma-separated addresses)"
        aria-label="Also email"
      />
      <ErrorLine error={post.error} />
      {result ? (
        <p role="status" className="text-[12.5px] text-ink-secondary">
          Posted{result.postedTo ? ` here and on ${result.postedTo} linked incident${result.postedTo === 1 ? '' : 's'}` : ''}
          {result.notified.length ? `; emailed ${result.notified.length}` : ''}.
          {result.notifyError ? <span className="block text-warning-ink">{result.notifyError}</span> : null}
        </p>
      ) : null}
      <Button type="submit" size="sm" leadingIcon={<Megaphone className="size-4" />} loading={post.isPending} disabled={!message.trim()}>
        Post update
      </Button>
    </form>
  );
}

/**
 * Major incident handling on the incident screen: the flag, the incidents
 * linked to it, and stakeholder updates. A child shows which major incident
 * it belongs to instead.
 */
export function MajorIncidentPanel({ incident }: { incident: IncidentDetail }) {
  const setMajor = useSetIncidentMajor(incident.id);
  const unlink = useUnlinkChildIncident(incident.id);
  const children = incident.childIncidents ?? [];
  const closed = incident.status === 'closed';

  if (incident.extrasAvailable === false) return null;

  return (
    <Card>
      <CardHeader
        title={incident.major ? 'Major incident' : 'Linked incidents'}
        subtitle={incident.major ? 'Related incidents and stakeholder updates.' : undefined}
        action={
          closed ? undefined : (
            <Button
              size="sm"
              variant={incident.major ? 'ghost' : 'secondary'}
              leadingIcon={<Siren className="size-4" />}
              loading={setMajor.isPending}
              onClick={() => setMajor.mutate(!incident.major)}
            >
              {incident.major ? 'Clear major' : 'Declare major'}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        <ErrorLine error={setMajor.error} />
        {incident.parentIncident ? (
          <p className="text-[13px] text-ink-secondary">
            Part of{' '}
            <Link to={`/incidents/${incident.parentIncident.id}`} className="font-medium text-brand-ink hover:underline">
              {incident.parentIncident.ref}
            </Link>{' '}
            {incident.parentIncident.summary}
          </p>
        ) : null}

        {children.length > 0 ? (
          <ul className="divide-y divide-line" aria-label="Linked incidents">
            {children.map((child) => (
              <li key={child.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                <span className="min-w-0 truncate">
                  <Link to={`/incidents/${child.id}`} className="font-medium text-brand-ink hover:underline">
                    {child.ref}
                  </Link>{' '}
                  <span className="text-ink-secondary">{child.summary}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <StatusPill status={child.status} size="sm" />
                  {closed ? null : (
                    <IconButton
                      size="sm"
                      label={`Unlink ${child.ref}`}
                      icon={<Unlink className="size-4" />}
                      onClick={() => unlink.mutate(child.id)}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : incident.major ? (
          <p className="text-[13px] text-ink-muted">No incidents linked yet.</p>
        ) : null}
        <ErrorLine error={unlink.error} />

        {incident.major && !closed ? (
          <>
            <LinkIncidentPicker incident={incident} />
            <div className="border-t border-line pt-4">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Stakeholder update</h3>
              <StakeholderUpdateForm incident={incident} />
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
