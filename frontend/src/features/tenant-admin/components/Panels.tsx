import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, buttonClasses, Card, Input, Select } from '@/components/ui';
import { env } from '@/config/env';
import { logoSrc } from '@/features/branding';
import { brandTokens, parseHex } from '@/lib/branding/palette';
import { ApiError } from '@/lib/api-client';
import {
  useCreateOrg,
  useCreateTeam,
  useSaveBranding,
  useSaveEmailDomains,
  useSaveHostnames,
  useTenantOrgs,
  useTenantPeople,
  useTenantTeams,
  useUpdateOrg,
  useUpdateTeam,
} from '../api/tenant-admin.api';
import type { EmailDomain, TeamRow, TenantDetail } from '../types';

const MAX_LOGO_BYTES = 200 * 1024;

/** A labelled field: the label is a real <label>, the hint is announced with the field. */
function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded-control border border-critical/40 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
      {message}
    </p>
  );
}

function SavedNote({ show }: { show: boolean }) {
  const { t } = useTranslation();
  return (
    <span role="status" className="text-[13px] text-good-ink">
      {show ? t('common.saved') : ''}
    </span>
  );
}

// ── Organisations ─────────────────────────────────────────────────────────

export function OrgsPanel({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation();
  const { data: orgs, isLoading, error } = useTenantOrgs(tenant.id);
  const create = useCreateOrg(tenant.id);
  const update = useUpdateOrg(tenant.id);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [parentId, setParentId] = useState('');
  const id = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, ...(code.trim() ? { code } : {}), ...(parentId ? { parentId: Number(parentId) } : {}) },
      { onSuccess: () => (setName(''), setCode(''), setParentId('')) },
    );
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">{t('tenantAdmin.orgs.add')}</h2>
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
          <Field label={t('common.name')} id={`${id}-name`}>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('common.code')} id={`${id}-code`}>
            <Input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('tenantAdmin.orgs.parent')} id={`${id}-parent`}>
            <Select
              id={`${id}-parent`}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              options={[{ value: '', label: t('common.none') }, ...tenant.orgs.map((o) => ({ value: String(o.id), label: o.name }))]}
            />
          </Field>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()} leadingIcon={<Plus className="size-4" />}>
            {t('common.add')}
          </Button>
        </form>
        <div className="mt-3">
          <ErrorNote error={create.error} />
          <SavedNote show={create.isSuccess} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? <p className="p-5 text-[13px] text-ink-muted">{t('common.loading')}</p> : null}
        <ErrorNote error={error ?? update.error} />
        {orgs && orgs.length === 0 ? <p className="p-5 text-[13px] text-ink-muted">{t('tenantAdmin.orgs.empty')}</p> : null}
        {orgs && orgs.length > 0 ? (
          <table className="w-full text-[13px]">
            <caption className="sr-only">{t('tenantAdmin.tabs.orgs')}</caption>
            <thead className="bg-surface-sunken text-start text-ink-secondary">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t('common.name')}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t('common.code')}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t('tenantAdmin.orgs.parent')}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium text-ink">{o.name}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{o.code || '—'}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{o.parentName || '—'}</td>
                  <td className="px-4 py-2.5">
                    <label className="sr-only" htmlFor={`${id}-status-${o.id}`}>
                      {t('common.status')}: {o.name}
                    </label>
                    <select
                      id={`${id}-status-${o.id}`}
                      value={o.status}
                      disabled={update.isPending}
                      onChange={(e) => update.mutate({ orgId: o.id, status: e.target.value as 'active' | 'inactive' })}
                      className="rounded-control border border-line-strong bg-surface px-2 py-1 text-ink"
                    >
                      <option value="active">{t('common.active')}</option>
                      <option value="inactive">{t('common.inactive')}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}

// ── Teams ─────────────────────────────────────────────────────────────────

function TeamCard({ tenantId, team }: { tenantId: string; team: TeamRow }) {
  const { t } = useTranslation();
  const update = useUpdateTeam(tenantId);
  const [q, setQ] = useState('');
  const { data: people } = useTenantPeople(tenantId, q);
  const id = useId();
  const memberIds = team.members.map((m) => m.id);
  const candidates = (people ?? []).filter((p) => !memberIds.includes(p.id));

  const setMembers = (ids: number[]) => update.mutate({ teamId: team.id, memberIds: ids });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{team.name}</h3>
        <span className="text-[12px] text-ink-muted">
          {team.orgName} · {t('tenantAdmin.teams.memberCount', { count: team.members.length })}
        </span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('tenantAdmin.teams.members')}>
        {team.members.map((m) => (
          <li key={m.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunken py-1 ps-3 pe-1 text-[13px] text-ink">
            {m.name}
            <button
              type="button"
              onClick={() => setMembers(memberIds.filter((x) => x !== m.id))}
              disabled={update.isPending}
              aria-label={t('tenantAdmin.teams.removeMember', { name: m.name })}
              className="inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 max-w-md space-y-2">
        <label htmlFor={`${id}-find`} className="block text-[13px] font-medium text-ink">
          {t('tenantAdmin.teams.addMember')}
        </label>
        <Input
          id={`${id}-find`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('tenantAdmin.teams.findPerson')}
          autoComplete="off"
        />
        {candidates.length > 0 ? (
          <ul className="divide-y divide-line rounded-control border border-line">
            {candidates.slice(0, 8).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] text-ink hover:bg-surface-hover"
                  onClick={() => {
                    setMembers([...memberIds, p.id]);
                    setQ('');
                  }}
                >
                  <UserPlus className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name} <span className="text-ink-muted">{p.email}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-3">
        <ErrorNote error={update.error} />
      </div>
    </Card>
  );
}

export function TeamsPanel({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation();
  const { data: teams, isLoading, error } = useTenantTeams(tenant.id);
  const create = useCreateTeam(tenant.id);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState(String(tenant.orgs[0]?.id ?? ''));
  const id = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, orgId: Number(orgId), ...(email.trim() ? { email } : {}) },
      { onSuccess: () => (setName(''), setEmail('')) },
    );
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">{t('tenantAdmin.teams.add')}</h2>
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[2fr_2fr_2fr_auto] sm:items-end">
          <Field label={t('common.name')} id={`${id}-name`}>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('common.email')} id={`${id}-email`}>
            <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('common.organisation')} id={`${id}-org`}>
            <Select
              id={`${id}-org`}
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              options={tenant.orgs.map((o) => ({ value: String(o.id), label: o.name }))}
            />
          </Field>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim() || !orgId} leadingIcon={<Plus className="size-4" />}>
            {t('common.add')}
          </Button>
        </form>
        <div className="mt-3">
          <ErrorNote error={create.error} />
        </div>
      </Card>
      {isLoading ? <p className="text-[13px] text-ink-muted">{t('common.loading')}</p> : null}
      <ErrorNote error={error} />
      {teams && teams.length === 0 ? <p className="text-[13px] text-ink-muted">{t('tenantAdmin.teams.empty')}</p> : null}
      {teams?.map((team) => <TeamCard key={team.id} tenantId={tenant.id} team={team} />)}
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────

export function UsersPanel() {
  const { t } = useTranslation();
  return (
    <Card className="p-5">
      <p className="max-w-2xl text-[14px] leading-6 text-ink-secondary">{t('tenantAdmin.usersLead')}</p>
      <Link to="/users" className={buttonClasses({ variant: 'primary', size: 'sm', className: 'mt-4' })}>
        {t('tenantAdmin.openUsers')}
      </Link>
    </Card>
  );
}

// ── Branding ──────────────────────────────────────────────────────────────

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** How the brand colour reads on both looks, with the contrast fixes applied. */
function BrandPreview({ accent, name, logo }: { accent: string; name: string; logo?: string }) {
  const { t } = useTranslation();
  const modes = useMemo(
    () => (['dark', 'light'] as const).map((mode) => ({ mode, tokens: parseHex(accent) ? brandTokens(accent, mode) : undefined })),
    [accent],
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label={t('tenantAdmin.branding.preview')} role="group">
      {modes.map(({ mode, tokens }) => (
        <div
          key={mode}
          data-public-theme={mode}
          style={tokens as Record<string, string> | undefined}
          className="rounded-card border border-line bg-canvas p-4"
        >
          <div className="flex items-center gap-2">
            {logo ? <img src={logo} alt="" className="size-8 object-contain" /> : null}
            <span className="text-[15px] font-semibold text-ink">{name}</span>
          </div>
          <p className="mt-3 text-[13px] text-brand-ink">{t('tenantAdmin.branding.preview')}</p>
          <span className="btn-brand mt-3 inline-flex h-9 items-center rounded-control bg-brand px-4 text-[13px] font-medium text-on-brand">
            {t('tenantAdmin.branding.previewButton')}
          </span>
        </div>
      ))}
    </div>
  );
}

export function BrandingPanel({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation();
  const save = useSaveBranding(tenant.id);
  const defaultName = `${env.appName} ${env.platformName}`;
  const [productName, setProductName] = useState(tenant.branding.productName ?? '');
  const [accent, setAccent] = useState(tenant.branding.accentColor ?? '#6d4aff');
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const id = useId();

  const currentLogo = logo ?? (logoRemoved || !tenant.branding.logoUrl ? undefined : logoSrc(tenant.branding.logoUrl));
  const validAccent = Boolean(parseHex(accent));

  const pick = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setFileError(t('tenantAdmin.branding.logoHint'));
    if (file.size > MAX_LOGO_BYTES) return setFileError(t('tenantAdmin.branding.logoHint'));
    setLogo(await readFile(file));
    setLogoRemoved(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      productName,
      accentColor: validAccent ? accent : '',
      // Left out, the logo stays as it is; an empty string removes it.
      ...(logo ? { logo } : logoRemoved ? { logo: '' } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card className="space-y-5 p-5">
        <p className="text-[14px] text-ink-secondary">{t('tenantAdmin.branding.lead')}</p>
        <Field label={t('tenantAdmin.branding.productName')} hint={t('tenantAdmin.branding.productNameHint', { default: defaultName })} id={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={productName}
            maxLength={60}
            placeholder={defaultName}
            aria-describedby={`${id}-name-hint`}
            onChange={(e) => setProductName(e.target.value)}
          />
        </Field>
        <Field label={t('tenantAdmin.branding.accent')} hint={t('tenantAdmin.branding.accentHint')} id={`${id}-accent`}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={validAccent ? accent : '#6d4aff'}
              onChange={(e) => setAccent(e.target.value)}
              aria-label={t('tenantAdmin.branding.accent')}
              className="h-9 w-12 cursor-pointer rounded-control border border-line-strong bg-surface"
            />
            <Input
              id={`${id}-accent`}
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              invalid={!validAccent}
              aria-invalid={!validAccent}
              aria-describedby={`${id}-accent-hint`}
              className="w-36"
              dir="ltr"
            />
          </div>
        </Field>
        <Field label={t('tenantAdmin.branding.logo')} hint={t('tenantAdmin.branding.logoHint')} id={`${id}-logo`}>
          <div className="flex flex-wrap items-center gap-3">
            {currentLogo ? <img src={currentLogo} alt={t('tenantAdmin.branding.logo')} className="size-12 rounded-control border border-line object-contain p-1" /> : null}
            <input
              id={`${id}-logo`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              aria-describedby={`${id}-logo-hint`}
              onChange={(e) => void pick(e.target.files?.[0])}
              className="text-[13px] text-ink-secondary file:me-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-ink"
            />
            {currentLogo ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<Trash2 className="size-4" />}
                onClick={() => {
                  setLogo(undefined);
                  setLogoRemoved(true);
                }}
              >
                {t('tenantAdmin.branding.removeLogo')}
              </Button>
            ) : null}
          </div>
          {fileError ? (
            <p role="alert" className="text-[12px] text-critical-ink">
              {fileError}
            </p>
          ) : null}
        </Field>
      </Card>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-ink">{t('tenantAdmin.branding.preview')}</h2>
        <BrandPreview accent={validAccent ? accent : '#6d4aff'} name={productName.trim() || defaultName} logo={currentLogo} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!validAccent}>
          {t('common.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setProductName('');
            setAccent('#6d4aff');
            setLogo(undefined);
            setLogoRemoved(true);
            save.mutate({ productName: '', accentColor: '', logo: '' });
          }}
        >
          {t('tenantAdmin.branding.reset')}
        </Button>
        <SavedNote show={save.isSuccess} />
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

// ── Domains ───────────────────────────────────────────────────────────────

export function DomainsPanel({ tenant, operator }: { tenant: TenantDetail; operator: boolean }) {
  const { t } = useTranslation();
  const saveEmail = useSaveEmailDomains(tenant.id);
  const saveHosts = useSaveHostnames(tenant.id);
  const [domains, setDomains] = useState<EmailDomain[]>(tenant.emailDomains);
  const [domain, setDomain] = useState('');
  const [orgId, setOrgId] = useState(String(tenant.orgs[0]?.id ?? ''));
  const [hosts, setHosts] = useState<string[]>(tenant.hostnames);
  const [host, setHost] = useState('');
  const id = useId();
  const orgName = (n: number) => tenant.orgs.find((o) => o.id === n)?.name ?? String(n);

  const saveDomains = (next: EmailDomain[]) => {
    setDomains(next);
    saveEmail.mutate(next, { onError: () => setDomains(tenant.emailDomains) });
  };
  const saveHostList = (next: string[]) => {
    setHosts(next);
    saveHosts.mutate(next, { onError: () => setHosts(tenant.hostnames) });
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">{t('tenantAdmin.domains.emailTitle')}</h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-ink-secondary">{t('tenantAdmin.domains.emailLead')}</p>
        <ul className="mt-4 divide-y divide-line rounded-control border border-line">
          {domains.length === 0 ? <li className="px-3 py-2.5 text-[13px] text-ink-muted">{t('tenantAdmin.domains.none')}</li> : null}
          {domains.map((d) => (
            <li key={d.domain} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="font-medium text-ink" dir="ltr">
                @{d.domain}
              </span>
              <span className="flex-1 text-ink-secondary">→ {orgName(d.orgId)}</span>
              <button
                type="button"
                onClick={() => saveDomains(domains.filter((x) => x.domain !== d.domain))}
                aria-label={`${t('common.remove')} ${d.domain}`}
                className="inline-flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[2fr_2fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            saveDomains([...domains, { domain: domain.trim().replace(/^@/, '').toLowerCase(), orgId: Number(orgId) }]);
            setDomain('');
          }}
        >
          <Field label={t('tenantAdmin.domains.domain')} id={`${id}-domain`}>
            <Input id={`${id}-domain`} dir="ltr" value={domain} placeholder={t('tenantAdmin.domains.domainPlaceholder')} onChange={(e) => setDomain(e.target.value)} />
          </Field>
          <Field label={t('common.organisation')} id={`${id}-org`}>
            <Select
              id={`${id}-org`}
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              options={tenant.orgs.map((o) => ({ value: String(o.id), label: o.name }))}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={!domain.trim() || !orgId} loading={saveEmail.isPending} leadingIcon={<Plus className="size-4" />}>
            {t('tenantAdmin.domains.addDomain')}
          </Button>
        </form>
        <div className="mt-3">
          <ErrorNote error={saveEmail.error} />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">{t('tenantAdmin.domains.hostTitle')}</h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-ink-secondary">{t('tenantAdmin.domains.hostLead')}</p>
        <ul className="mt-4 divide-y divide-line rounded-control border border-line">
          {hosts.length === 0 ? <li className="px-3 py-2.5 text-[13px] text-ink-muted">{t('tenantAdmin.domains.none')}</li> : null}
          {hosts.map((h) => (
            <li key={h} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="flex-1 font-medium text-ink" dir="ltr">
                {h}
              </span>
              {operator ? (
                <button
                  type="button"
                  onClick={() => saveHostList(hosts.filter((x) => x !== h))}
                  aria-label={`${t('common.remove')} ${h}`}
                  className="inline-flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {operator ? (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[4fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              saveHostList([...hosts, host.trim().toLowerCase()]);
              setHost('');
            }}
          >
            <Field label={t('tenantAdmin.domains.hostTitle')} id={`${id}-host`}>
              <Input id={`${id}-host`} dir="ltr" value={host} placeholder={t('tenantAdmin.domains.hostPlaceholder')} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" disabled={!host.trim()} loading={saveHosts.isPending} leadingIcon={<Plus className="size-4" />}>
              {t('tenantAdmin.domains.addHost')}
            </Button>
          </form>
        ) : null}
        <div className="mt-3">
          <ErrorNote error={saveHosts.error} />
        </div>
      </Card>
    </div>
  );
}
