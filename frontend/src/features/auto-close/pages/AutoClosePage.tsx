import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useAutoClose, useRunAutoClose, useSaveAutoClose } from '../api/useAutoClose';
import type { AutoCloseRun, AutoCloseSettings } from '../types';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

const pick = (s: AutoCloseSettings): AutoCloseSettings => ({
  enabled: s.enabled,
  days: s.days,
  requests: s.requests,
  incidents: s.incidents,
  remind: s.remind,
  remindDaysBefore: s.remindDaysBefore,
});

const same = (a: AutoCloseSettings, b: AutoCloseSettings) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));

/** What is wrong with the form, or undefined. Mirrors the BFF's check. */
function problem(s: AutoCloseSettings): string | undefined {
  if (!Number.isInteger(s.days) || s.days < 1 || s.days > 365) return 'Close after 1 to 365 days.';
  if (s.remind && (!Number.isInteger(s.remindDaysBefore) || s.remindDaysBefore < 1 || s.remindDaysBefore >= s.days)) {
    return 'The reminder has to go at least a day before the ticket closes.';
  }
  return undefined;
}

/**
 * When a resolved ticket closes by itself if the customer neither confirms
 * nor reopens it, and the reminder they get before. Per customer (tenant).
 * Administrators only.
 */
export function AutoClosePage() {
  const { data, isLoading, isError, error } = useAutoClose();
  const save = useSaveAutoClose();
  const [form, setForm] = useState<AutoCloseSettings | null>(null);

  useEffect(() => {
    if (data) setForm(pick(data));
  }, [data]);

  const dirty = Boolean(data && form && !same(form, data));
  const invalid = form ? problem(form) : undefined;
  const set = (patch: Partial<AutoCloseSettings>) => setForm((f) => f && { ...f, ...patch });
  const checkbox = (key: 'enabled' | 'requests' | 'incidents' | 'remind', label: string) => (
    <label className="flex items-center gap-2 text-[13px] text-ink">
      <input type="checkbox" checked={form?.[key] ?? false} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Auto-close' }]}
        title="Auto-close"
        description="Resolved tickets the customer neither confirms nor reopens close by themselves after a while."
      />
      {isError ? (
        <div role="alert" className={`${ALERT} mb-6 border-critical/30 bg-critical-soft text-critical-ink`}>
          Couldn’t load the settings. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}
      {data && data.checkEveryMinutes === 0 ? (
        <div role="status" className={`${ALERT} mb-4 border-warning/30 bg-warning-soft text-ink`}>
          The background check is off on this server (AUTO_CLOSE_CHECK_MINUTES=0), so nothing closes by itself.
          “Run now” still works.
        </div>
      ) : null}

      <Card className="max-w-2xl">
        <CardHeader
          title="Closing resolved tickets"
          subtitle={
            data?.updatedAt
              ? `Last changed by ${data.updatedBy || 'an administrator'}, ${dateTimeText(data.updatedAt)}.`
              : 'The platform’s defaults apply.'
          }
        />
        <CardBody>
          {isLoading || !form || !data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!invalid) save.mutate(form);
              }}
            >
              {checkbox('enabled', 'Close resolved tickets automatically')}

              <fieldset disabled={!form.enabled} className="space-y-4 disabled:opacity-60">
                <div className="space-y-1.5">
                  <label htmlFor="ac-days" className="block text-[13px] font-medium text-ink">
                    Close after (calendar days since it was resolved)
                  </label>
                  <Input
                    id="ac-days"
                    type="number"
                    min={1}
                    max={365}
                    className="w-32"
                    value={form.days}
                    onChange={(e) => set({ days: Number(e.target.value) })}
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[13px] font-medium text-ink">Applies to</p>
                  {checkbox('requests', 'Service requests')}
                  {checkbox('incidents', 'Incidents')}
                </div>

                <div className="space-y-1.5">
                  {checkbox('remind', 'Email the caller before the ticket closes')}
                  {form.remind ? (
                    <div className="flex items-center gap-2 pl-6 text-[13px] text-ink">
                      <Input
                        id="ac-remind"
                        aria-label="Days before closing"
                        type="number"
                        min={1}
                        max={Math.max(1, form.days - 1)}
                        className="w-20"
                        value={form.remindDaysBefore}
                        onChange={(e) => set({ remindDaysBefore: Number(e.target.value) })}
                      />
                      <label htmlFor="ac-remind">days before closing</label>
                    </div>
                  ) : null}
                  {form.remind && !data.mailConfigured ? (
                    <p className="pl-6 text-[12.5px] text-warning-ink">No mail server is configured, so no email will be sent.</p>
                  ) : null}
                </div>
              </fieldset>

              <p className="text-[12px] text-ink-muted">
                Until then the customer can confirm or reopen the ticket in the portal; reopening and resolving again
                starts the count over. A closed ticket stays closed. The closing adds a note to the ticket’s log.
              </p>

              {invalid ? <p className="text-[12.5px] text-critical-ink">{invalid}</p> : null}
              {save.isError ? (
                <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
                  {save.error instanceof Error ? save.error.message : 'The settings could not be saved.'}
                </div>
              ) : null}
              {save.isSuccess && !dirty ? (
                <div role="status" className={`${ALERT} border-good/30 bg-good-soft text-good-ink`}>
                  Saved. The next check uses them.
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                {dirty ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setForm(pick(data))}>
                    Discard changes
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={!dirty || Boolean(invalid)} loading={save.isPending}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      {data ? <LastRun run={data.lastRun} checkEveryMinutes={data.checkEveryMinutes} /> : null}
    </>
  );
}

const ACTION_TEXT = { closed: 'Closed', reminded: 'Reminder sent', failed: 'Not done' } as const;

/** The last check for this customer, and "Run now". */
function LastRun({ run, checkEveryMinutes }: { run?: AutoCloseRun; checkEveryMinutes: number }) {
  const runNow = useRunAutoClose();
  const shown = runNow.data ?? run;
  const count = (action: keyof typeof ACTION_TEXT) => shown?.outcomes.filter((o) => o.action === action).length ?? 0;

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader
        title="Last check"
        subtitle={
          checkEveryMinutes > 0
            ? `The server checks every ${checkEveryMinutes === 60 ? 'hour' : `${checkEveryMinutes} minutes`}.`
            : 'The server does not check by itself.'
        }
      />
      <CardBody>
        {shown ? (
          <div className="space-y-2 text-[13px] text-ink">
            <p role="status">
              {dateTimeText(shown.finishedAt)}: {count('closed')} closed, {count('reminded')} reminded
              {count('failed') ? `, ${count('failed')} not done` : ''}.
              {shown.truncated ? ' More were due; the next check takes the rest.' : ''}
            </p>
            {shown.error ? <p className="text-critical-ink">{shown.error}</p> : null}
            {shown.outcomes.length > 0 ? (
              <ul className="max-h-64 space-y-1 overflow-auto">
                {shown.outcomes.map((o) => (
                  <li key={`${o.class}-${o.id}`}>
                    <span className="font-medium">{o.ref}</span>: {ACTION_TEXT[o.action]}
                    {o.reason ? <span className="text-ink-muted"> ({o.reason})</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">No check since the server started.</p>
        )}
        {runNow.isError ? (
          <p role="alert" className="mt-2 text-[13px] text-critical-ink">
            {runNow.error instanceof Error ? runNow.error.message : 'The check could not run.'}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" loading={runNow.isPending} onClick={() => runNow.mutate()}>
            Run now
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
