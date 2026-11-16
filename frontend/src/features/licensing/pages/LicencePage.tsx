import { useState } from 'react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { cn, dateTimeText } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import {
  useAcceptEula,
  useCheckLicence,
  useInstallLicence,
  useLicence,
  useUsageReport,
} from '../api/licensing.api';
import type { LicenceCheckResult, LicenceDetail, UsageRow } from '../types';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

const STATE_TEXT: Record<LicenceDetail['status']['state'], string> = {
  valid: 'Valid',
  expiring_soon: 'Ending soon',
  grace: 'In grace',
  read_only: 'Read-only',
  evaluation_mode: 'No valid licence',
  trial: 'Evaluation',
  evaluation_expired: 'Evaluation ended',
};

const TYPE_TEXT: Record<string, string> = {
  subscription: 'Subscription',
  perpetual: 'Perpetual with maintenance',
  evaluation: 'Evaluation',
  nonprod: 'Non-production',
};

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

/** One row of usage against entitlement: a bar coloured at 80% and 100%. */
function UsageBar({ row }: { row: UsageRow }) {
  const pct = row.percent === null ? 0 : Math.min(100, row.percent);
  const tone =
    row.level === 'over' || row.level === 'full' ? 'bg-critical' : row.level === 'warning' ? 'bg-warning' : 'bg-brand';
  return (
    <div className="space-y-1" data-metric={row.metric}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-ink">{row.label}</span>
        <span className="tabular-nums text-ink-secondary">
          {row.limit === null ? `${row.used} (not limited)` : `${row.used} of ${row.limit}`}
          {row.percent !== null && row.limit ? ` · ${row.percent}%` : ''}
        </span>
      </div>
      {row.limit !== null ? (
        <div className="h-2 overflow-hidden rounded-full bg-line" role="presentation">
          <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] text-ink">{value || '—'}</dd>
    </div>
  );
}

/** Paste or choose a .lic file; checked before saving, with what it changes. */
function InstallKey({ detail }: { detail: LicenceDetail }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<LicenceCheckResult | null>(null);
  const [eula, setEula] = useState(false);
  const check = useCheckLicence();
  const install = useInstallLicence();
  const needsEula = detail.eula.required;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setResult(null);
  };

  return (
    <Card>
      <CardHeader title="Install a licence" subtitle="Paste the licence text or choose the .lic file. It is checked before anything is saved." />
      <CardBody>
        <div className="space-y-3">
          <label htmlFor="licence-text" className="block text-[13px] font-medium text-ink">
            Licence
          </label>
          <textarea
            id="licence-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            rows={6}
            spellCheck={false}
            placeholder="-----BEGIN ARCUS LICENCE-----"
            className="w-full rounded-card border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[13px] text-ink-secondary">
              <span className="sr-only">Licence file</span>
              <input type="file" accept=".lic,text/plain" aria-label="Licence file" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={text.trim().length < 20 || check.isPending}
              onClick={() => check.mutate(text, { onSuccess: setResult })}
            >
              Check
            </Button>
          </div>

          {check.isError ? <p role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>{errorText(check.error)}</p> : null}
          {result && !result.ok ? (
            <p role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
              Not installed: {result.message}
            </p>
          ) : null}
          {result?.ok && result.summary ? (
            <div className={`${ALERT} border-line bg-raised text-ink`} data-testid="licence-changes">
              <p className="font-medium">
                {result.summary.licenceId} for {result.summary.customer}: {result.summary.editionName}
              </p>
              <ul className="mt-1 list-disc ps-5">
                {result.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {result.older ? <p className="mt-1 text-warning-ink">This licence was issued before the one installed now.</p> : null}
            </div>
          ) : null}

          {result?.ok && needsEula ? (
            <div className="space-y-2">
              <div className="max-h-40 overflow-y-auto rounded-card border border-line bg-surface p-3 text-[12px] text-ink-secondary whitespace-pre-line" data-testid="eula-text">
                {detail.eula.text}
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={eula} onChange={(e) => setEula(e.target.checked)} />I accept the end-user licence agreement
              </label>
            </div>
          ) : null}

          {result?.ok ? (
            <Button
              size="sm"
              disabled={install.isPending || (needsEula && !eula)}
              onClick={() =>
                install.mutate(
                  { text, ...(result.older ? { confirmOlder: true } : {}), ...(needsEula ? { acceptEula: true } : {}) },
                  {
                    onSuccess: () => {
                      setText('');
                      setResult(null);
                    },
                  },
                )
              }
            >
              {result.older ? 'Install the older licence' : 'Install licence'}
            </Button>
          ) : null}
          {install.isError ? <p role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>{errorText(install.error)}</p> : null}
          {install.isSuccess ? <p role="status" className={`${ALERT} border-line bg-raised text-ink`}>Installed. It applies now.</p> : null}
        </div>
      </CardBody>
    </Card>
  );
}

/** The signed usage report for a period (LIC-14). */
function UsageReport() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const report = useUsageReport();
  return (
    <Card>
      <CardHeader title="Usage report" subtitle="The daily figures and peaks for a period, signed by this installation, for Intertec." />
      <CardBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-[13px] text-ink">
            <span className="block font-medium">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          </label>
          <label className="space-y-1 text-[13px] text-ink">
            <span className="block font-medium">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </label>
          <Button size="sm" variant="secondary" disabled={!from || !to || from > to || report.isPending} onClick={() => report.mutate({ from, to })}>
            Download report
          </Button>
        </div>
        {report.isError ? <p role="alert" className={`${ALERT} mt-3 border-critical/30 bg-critical-soft text-critical-ink`}>{errorText(report.error)}</p> : null}
      </CardBody>
    </Card>
  );
}

/** SaaS: the tenant's first administrator accepts the terms (LIC-17). */
function AcceptTerms({ detail }: { detail: LicenceDetail }) {
  const accept = useAcceptEula();
  const [ok, setOk] = useState(false);
  return (
    <Card>
      <CardHeader title="Terms of service" subtitle="Accept the terms once for your organisation." />
      <CardBody>
        <div className="max-h-48 overflow-y-auto rounded-card border border-line bg-surface p-3 text-[12px] text-ink-secondary whitespace-pre-line">{detail.eula.text}</div>
        <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I accept the terms on behalf of my organisation
        </label>
        <Button size="sm" className="mt-3" disabled={!ok || accept.isPending} onClick={() => accept.mutate()}>
          Accept
        </Button>
        {accept.isError ? <p role="alert" className={`${ALERT} mt-3 border-critical/30 bg-critical-soft text-critical-ink`}>{errorText(accept.error)}</p> : null}
      </CardBody>
    </Card>
  );
}

/**
 * The licence page (Build Guide, section 11): what was bought, what is used,
 * what happens next. Administrators only.
 */
export function LicencePage() {
  const { data, isLoading, isError, error } = useLicence();

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Licence' }]}
      title="Licence"
      description="What your organisation bought, what it uses, and what happens next."
    />
  );
  if (isError && error instanceof ApiError && error.isNotFound) {
    return (
      <>
        {header}
        <Card className="max-w-2xl">
          <CardBody>
            <p className="text-[13px] text-ink-secondary">Licensing is not switched on for this service, so every module is available and nothing is counted.</p>
          </CardBody>
        </Card>
      </>
    );
  }
  if (isError) {
    return (
      <>
        {header}
        <p role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>Couldn’t load the licence. {errorText(error)}</p>
      </>
    );
  }
  if (isLoading || !data) {
    return (
      <>
        {header}
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  const { status, summary } = data;
  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Summary" subtitle={STATE_TEXT[status.state]} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3" data-testid="licence-summary">
              <Fact label="Customer" value={summary?.customer} />
              <Fact label="Edition" value={summary?.editionName ?? (status.state === 'trial' ? 'Evaluation (all features)' : null)} />
              <Fact label="Licence type" value={summary ? TYPE_TEXT[summary.licenceType] : null} />
              <Fact label="State" value={STATE_TEXT[status.state]} />
              <Fact label="From" value={summary?.validFrom} />
              <Fact label="Until" value={summary ? (summary.expiresAt ?? 'Perpetual') : null} />
              <Fact label="Days left" value={status.daysLeft === null ? null : String(Math.max(0, status.daysLeft))} />
              {summary?.maintenanceUntil ? <Fact label="Maintenance until" value={summary.maintenanceUntil} /> : null}
              <Fact label="Licence id" value={summary?.licenceId} />
              <Fact label="Order" value={summary?.orderRef} />
            </dl>
            {status.maintenanceLapsed ? (
              <p className={`${ALERT} mt-3 border-warning/30 bg-warning-soft text-ink`}>Maintenance has ended: releases made after {summary?.maintenanceUntil} cannot be installed with this licence.</p>
            ) : null}
            {data.eula.acceptedBy ? (
              <p className="mt-3 text-[12px] text-ink-muted">
                Terms accepted by {data.eula.acceptedBy}, {dateTimeText(data.eula.acceptedAt!)}.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Usage against entitlement" subtitle="Warnings at 80% and 100%; 10% more is allowed, then new use pauses." />
          <CardBody>
            <div className="space-y-4" data-testid="licence-usage">
              {data.usage.map((row) => (
                <UsageBar key={row.metric} row={row} />
              ))}
            </div>
          </CardBody>
        </Card>

        {data.eula.required && !data.canInstall ? <AcceptTerms detail={data} /> : null}
        {data.canInstall ? (
          <InstallKey detail={data} />
        ) : (
          <Card>
            <CardHeader title="Changing the licence" />
            <CardBody>
              <p className="text-[13px] text-ink-secondary">Your licence is installed by the platform operator. Ask them for a new key when you renew or upgrade.</p>
            </CardBody>
          </Card>
        )}

        {data.installation ? (
          <Card>
            <CardHeader title="This installation" subtitle="Intertec binds the licence to this id, and checks usage reports with this key." />
            <CardBody>
              <dl className="grid gap-3" data-testid="licence-installation">
                <Fact label="Installation id" value={data.installation.id} />
                <Fact label="Report key" value={data.installation.reportKeyId} />
              </dl>
              <details className="mt-3 text-[12px] text-ink-secondary">
                <summary className="cursor-pointer">Public key</summary>
                <pre className="mt-2 overflow-x-auto rounded-card border border-line bg-surface p-2 font-mono">{data.installation.reportPublicKey}</pre>
              </details>
            </CardBody>
          </Card>
        ) : null}

        <UsageReport />

        <Card className="xl:col-span-2">
          <CardHeader title="History" subtitle="Keys installed, state changes, warnings and refusals." />
          <CardBody>
            {data.history.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Nothing yet.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-start text-[12px] text-ink-muted">
                    <th className="py-1 text-start font-medium">When</th>
                    <th className="py-1 text-start font-medium">What</th>
                    <th className="py-1 text-start font-medium">Who</th>
                    <th className="py-1 text-start font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((e) => (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="py-1.5 pe-3 whitespace-nowrap text-ink-secondary">{dateTimeText(e.at)}</td>
                      <td className="py-1.5 pe-3 text-ink">{e.label}</td>
                      <td className="py-1.5 pe-3 text-ink-secondary">{e.actor ?? '—'}</td>
                      <td className="py-1.5 text-ink-secondary">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
