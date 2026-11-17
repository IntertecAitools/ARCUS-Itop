import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { dateTimeText } from '@/lib/utils';
import { useIssueLicence, useLicences, useReissueLicence, useRevokeLicence } from '../api/desk.api';
import type { Edition, IssueLicenceInput, IssueLicenceResult, LicenceType, RegisterRow } from '../types';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';
const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
const STATUS: Record<RegisterRow['status'], string> = { current: 'Current', replaced: 'Replaced', revoked: 'Revoked' };

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

const SELECT = 'h-9 w-full rounded-card border border-line bg-surface px-2 text-[13px] text-ink';

/** Saves the .lic text of an issued licence for a deployed customer. */
function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One form for an order: a licence, and for a new SaaS customer the tenant created with it. */
function IssueForm({ canIssue, onIssued }: { canIssue: boolean; onIssued: (r: IssueLicenceResult) => void }) {
  const issue = useIssueLicence();
  const [f, setF] = useState({
    customer: '',
    orderRef: '',
    type: 'subscription' as LicenceType,
    termYears: '1',
    edition: 'PRO' as Edition,
    deployment: 'saas' as 'saas' | 'deployed',
    newTenant: true,
    tenantId: '',
    domains: '',
    orgIds: '',
    binding: '',
    agents: '10',
    ciPacks: '0',
    aiPacks: '0',
    validFrom: '',
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const saasNew = f.deployment === 'saas' && f.newTenant;
  const binding = saasNew ? `tenant:${f.tenantId}` : f.binding;

  const submit = () => {
    const input: IssueLicenceInput = {
      customer: f.customer,
      orderRef: f.orderRef,
      type: f.type,
      ...(f.type === 'subscription' ? { termYears: Number(f.termYears) } : {}),
      edition: f.edition,
      deployment: f.deployment,
      binding,
      agents: Number(f.agents),
      ciPacks: Number(f.ciPacks) || 0,
      aiPacks: Number(f.aiPacks) || 0,
      ...(f.validFrom ? { validFrom: f.validFrom } : {}),
      ...(saasNew
        ? {
            newTenant: {
              id: f.tenantId,
              name: f.customer,
              domains: f.domains.split(',').map((d) => d.trim()).filter(Boolean),
              orgIds: f.orgIds.split(',').map((d) => Number(d.trim())).filter((n) => n > 0),
            },
          }
        : {}),
    };
    issue.mutate(input, { onSuccess: onIssued });
  };

  return (
    <Card>
      <CardHeader title="Issue a licence" subtitle="An order becomes a signed licence, recorded in the register. A new SaaS customer's tenant is created in the same step." />
      <CardBody>
        {!canIssue ? (
          <p className={`${ALERT} mb-4 border-warning/30 bg-warning-soft text-ink`}>
            This server cannot sign licences (no signing key configured). Issue licences with the CLI: <code>npm run licence -- issue …</code>
          </p>
        ) : null}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Customer" htmlFor="ld-customer">
            <Input id="ld-customer" value={f.customer} onChange={(e) => set({ customer: e.target.value })} required />
          </Field>
          <Field label="Order reference" htmlFor="ld-order">
            <Input id="ld-order" value={f.orderRef} onChange={(e) => set({ orderRef: e.target.value })} />
          </Field>
          <Field label="Edition" htmlFor="ld-edition">
            <select id="ld-edition" className={SELECT} value={f.edition} onChange={(e) => set({ edition: e.target.value as Edition })}>
              <option value="ESS">Essentials</option>
              <option value="PRO">Professional</option>
              <option value="ENT">Enterprise</option>
            </select>
          </Field>
          <Field label="Deployment" htmlFor="ld-deployment">
            <select id="ld-deployment" className={SELECT} value={f.deployment} onChange={(e) => set({ deployment: e.target.value as 'saas' | 'deployed' })}>
              <option value="saas">SaaS (a tenant)</option>
              <option value="deployed">Deployed (an installation)</option>
            </select>
          </Field>
          <Field label="Licence type" htmlFor="ld-type">
            <select id="ld-type" className={SELECT} value={f.type} onChange={(e) => set({ type: e.target.value as LicenceType })}>
              <option value="subscription">Subscription</option>
              <option value="perpetual">Perpetual with maintenance</option>
              <option value="evaluation">Evaluation (30 days)</option>
              <option value="nonprod">Non-production</option>
            </select>
          </Field>
          {f.type === 'subscription' ? (
            <Field label="Term (years)" htmlFor="ld-term">
              <select id="ld-term" className={SELECT} value={f.termYears} onChange={(e) => set({ termYears: e.target.value })}>
                <option value="1">1</option>
                <option value="3">3</option>
                <option value="5">5</option>
              </select>
            </Field>
          ) : null}
          <Field label="Agents" htmlFor="ld-agents">
            <Input id="ld-agents" type="number" min={1} value={f.agents} onChange={(e) => set({ agents: e.target.value })} />
          </Field>
          <Field label="CI packs" htmlFor="ld-ci">
            <Input id="ld-ci" type="number" min={0} value={f.ciPacks} onChange={(e) => set({ ciPacks: e.target.value })} />
          </Field>
          <Field label="AI packs" htmlFor="ld-ai">
            <Input id="ld-ai" type="number" min={0} value={f.aiPacks} onChange={(e) => set({ aiPacks: e.target.value })} />
          </Field>
          <Field label="Valid from" htmlFor="ld-from">
            <Input id="ld-from" type="date" value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
          </Field>

          {f.deployment === 'saas' ? (
            <label className="flex items-center gap-2 text-[13px] text-ink sm:col-span-2">
              <input type="checkbox" checked={f.newTenant} onChange={(e) => set({ newTenant: e.target.checked })} />A new customer: create its tenant
            </label>
          ) : null}
          {saasNew ? (
            <>
              <Field label="Tenant id" htmlFor="ld-tenant">
                <Input id="ld-tenant" value={f.tenantId} onChange={(e) => set({ tenantId: e.target.value.toLowerCase() })} placeholder="acme" />
              </Field>
              <Field label="Site host names (comma-separated)" htmlFor="ld-domains">
                <Input id="ld-domains" value={f.domains} onChange={(e) => set({ domains: e.target.value })} placeholder="acme.servicedesk.example" />
              </Field>
              <Field label="Organisation ids (comma-separated)" htmlFor="ld-orgs">
                <Input id="ld-orgs" value={f.orgIds} onChange={(e) => set({ orgIds: e.target.value })} placeholder="12, 13" />
              </Field>
            </>
          ) : (
            <Field label="Binding" htmlFor="ld-binding">
              <Input
                id="ld-binding"
                value={f.binding}
                onChange={(e) => set({ binding: e.target.value })}
                placeholder={f.deployment === 'saas' ? 'tenant:acme' : 'install:<installation id>'}
              />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={!canIssue || issue.isPending || !f.customer || !binding.replace(/^tenant:$/, '')}>
              Issue licence
            </Button>
          </div>
        </form>
        {issue.isError ? <p role="alert" className={`${ALERT} mt-3 border-critical/30 bg-critical-soft text-critical-ink`}>{errorText(issue.error)}</p> : null}
      </CardBody>
    </Card>
  );
}

function Outcome({ result }: { result: IssueLicenceResult }) {
  const l = result.licence;
  return (
    <p role="status" className={`${ALERT} border-line bg-raised text-ink`} data-testid="issued">
      Issued {l.licenceId} for {l.customer} ({l.edition}, {l.binding}).
      {result.tenantCreated ? ' The tenant was created.' : ''}
      {result.installed ? ' Installed for the tenant: it applies now.' : ' Send the licence file to the customer.'}{' '}
      <button type="button" className="text-brand underline" onClick={() => saveText(`${l.licenceId}.lic`, result.text)}>
        Download {l.licenceId}.lic
      </button>
    </p>
  );
}

/** A row's actions: re-issue (with a reason, and an edition or agents to change) and revoke. */
function RowActions({ row, canIssue, onIssued }: { row: RegisterRow; canIssue: boolean; onIssued: (r: IssueLicenceResult) => void }) {
  const reissue = useReissueLicence();
  const revoke = useRevokeLicence();
  const [mode, setMode] = useState<'none' | 'reissue' | 'revoke'>('none');
  const [reason, setReason] = useState('');
  const [agents, setAgents] = useState('');
  const [edition, setEdition] = useState<Edition | ''>('');
  if (row.status !== 'current') return null;
  if (mode === 'none') {
    return (
      <div className="flex gap-2">
        {canIssue ? (
          <Button size="sm" variant="secondary" onClick={() => setMode('reissue')}>
            Re-issue
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setMode('revoke')}>
          Revoke
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'revoke') revoke.mutate({ id: row.licenceId, reason }, { onSuccess: () => setMode('none') });
        else
          reissue.mutate(
            { id: row.licenceId, reason, ...(agents ? { agents: Number(agents) } : {}), ...(edition ? { edition } : {}) },
            {
              onSuccess: (r) => {
                setMode('none');
                onIssued(r);
              },
            },
          );
      }}
    >
      <Input aria-label="Reason" placeholder={mode === 'revoke' ? 'contract ended' : 'upgrade'} value={reason} onChange={(e) => setReason(e.target.value)} className="w-40" />
      {mode === 'reissue' ? (
        <>
          <select aria-label="New edition" className={`${SELECT} w-32`} value={edition} onChange={(e) => setEdition(e.target.value as Edition | '')}>
            <option value="">Same edition</option>
            <option value="ESS">Essentials</option>
            <option value="PRO">Professional</option>
            <option value="ENT">Enterprise</option>
          </select>
          <Input aria-label="New agents" type="number" min={1} placeholder="Agents" value={agents} onChange={(e) => setAgents(e.target.value)} className="w-24" />
        </>
      ) : null}
      <Button type="submit" size="sm" disabled={!reason.trim() || reissue.isPending || revoke.isPending}>
        {mode === 'revoke' ? 'Revoke licence' : 'Re-issue licence'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setMode('none')}>
        Cancel
      </Button>
      {reissue.isError || revoke.isError ? <span role="alert" className="text-[12px] text-critical-ink">{errorText(reissue.error ?? revoke.error)}</span> : null}
    </form>
  );
}

function RenewalList({ title, rows }: { title: string; rows: RegisterRow[] }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-ink-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">None</p>
      ) : (
        <ul className="text-[13px] text-ink">
          {rows.map((r) => (
            <li key={r.licenceId}>
              {r.customer}: {r.licenceId}, ends {r.expiresAt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The licence desk (Build Guide, section 5, step C): the licence register,
 * issuing, re-issuing and revoking, and the renewals due. Platform
 * operators only, on the platform's own address.
 */
export function LicencesPage() {
  const [customer, setCustomer] = useState('');
  const { data, isLoading, isError, error } = useLicences(customer.trim() || undefined);
  const [issued, setIssued] = useState<IssueLicenceResult | null>(null);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Licences' }]}
        title="Licences"
        description="Every licence Intertec issued: issue, re-issue, revoke, and the renewals due."
      />
      {isError ? (
        <p role="alert" className={`${ALERT} mb-6 border-critical/30 bg-critical-soft text-critical-ink`}>
          {errorText(error)}
        </p>
      ) : null}
      {isLoading || (!data && !isError) ? <Skeleton className="h-64 w-full" /> : null}
      {data ? (
        <div className="space-y-6">
          {issued ? <Outcome result={issued} /> : null}
          <Card>
            <CardHeader title="Renewals due" subtitle="Current licences ending in the next 90 days." />
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-3" data-testid="renewals">
                <RenewalList title="Within 30 days" rows={data.renewals.within30} />
                <RenewalList title="Within 60 days" rows={data.renewals.within60} />
                <RenewalList title="Within 90 days" rows={data.renewals.within90} />
              </div>
            </CardBody>
          </Card>

          <IssueForm canIssue={data.canIssue} onIssued={setIssued} />

          <Card>
            <CardHeader title="Register" subtitle="Who issued each licence, when and why. Nothing is ever deleted." />
            <CardBody>
              <div className="mb-3 max-w-xs">
                <Input aria-label="Filter by customer" placeholder="Filter by customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
              </div>
              {data.licences.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No licences yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]" data-testid="register">
                    <thead>
                      <tr className="text-[12px] text-ink-muted">
                        {['Licence', 'Customer', 'Edition', 'Type', 'Valid', 'Binding', 'Status', 'Issued', ''].map((h) => (
                          <th key={h} className="py-1 pe-3 text-start font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.licences.map((r) => (
                        <tr key={r.licenceId} className="border-t border-line align-top">
                          <td className="py-1.5 pe-3 font-mono text-ink">{r.licenceId}</td>
                          <td className="py-1.5 pe-3 text-ink">{r.customer}</td>
                          <td className="py-1.5 pe-3">{r.edition}</td>
                          <td className="py-1.5 pe-3">{r.licenceType}</td>
                          <td className="py-1.5 pe-3 whitespace-nowrap">
                            {r.validFrom} → {r.expiresAt ?? 'perpetual'}
                          </td>
                          <td className="py-1.5 pe-3 font-mono text-[12px]">{r.binding}</td>
                          <td className="py-1.5 pe-3">
                            {STATUS[r.status]}
                            {r.replacedBy ? ` by ${r.replacedBy}` : ''}
                            {r.revokeReason ? `: ${r.revokeReason}` : ''}
                          </td>
                          <td className="py-1.5 pe-3 text-ink-secondary">
                            {r.issuedBy}, {dateTimeText(r.issuedAt)} ({r.reason})
                          </td>
                          <td className="py-1.5">
                            <RowActions row={r} canIssue={data.canIssue} onIssued={setIssued} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}
