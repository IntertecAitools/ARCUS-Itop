import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout';
import { Card, Select, Tabs } from '@/components/ui';
import { useTenant, useTenants } from '../api/tenant-admin.api';
import { BrandingPanel, DomainsPanel, OrgsPanel, TeamsPanel, UsersPanel } from '../components/Panels';

const TABS = ['orgs', 'teams', 'users', 'branding', 'domains'] as const;
type Tab = (typeof TABS)[number];

/**
 * A customer's own administration: their organisations, teams, people,
 * branding and email domains, without iTop. The BFF keeps a customer's
 * administrator to their own tenant; the platform operator picks any.
 */
export function TenantAdminPage() {
  const { t } = useTranslation();
  const { data: list, isLoading, isError } = useTenants();
  const [tenantId, setTenantId] = useState('');
  const [tab, setTab] = useState<Tab>('orgs');
  const { data: tenant, isError: tenantError } = useTenant(tenantId);
  const pickerId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!tenantId && list?.tenants[0]) setTenantId(list.tenants[0].id);
  }, [list, tenantId]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: t('tenantAdmin.title') }]}
        title={tenant ? `${t('tenantAdmin.title')} · ${tenant.name}` : t('tenantAdmin.title')}
        description={t('tenantAdmin.lead')}
        actions={
          list?.operator && list.tenants.length > 1 ? (
            <div className="flex items-center gap-2">
              <label htmlFor={pickerId} className="text-[13px] text-ink-secondary">
                {t('tenantAdmin.customer')}
              </label>
              <Select
                id={pickerId}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                options={list.tenants.map((x) => ({ value: x.id, label: x.name }))}
                className="w-56"
              />
            </div>
          ) : null
        }
      />

      {isLoading ? <p className="text-[13px] text-ink-muted">{t('common.loading')}</p> : null}
      {isError || tenantError ? (
        <p role="alert" className="text-[13px] text-critical-ink">
          {t('common.couldNotLoad')}
        </p>
      ) : null}
      {list && list.tenants.length === 0 ? (
        <Card className="p-5 text-[14px] text-ink-secondary">{t('tenantAdmin.off')}</Card>
      ) : null}

      {tenant ? (
        <>
          <Tabs
            items={TABS.map((id) => ({ id, label: t(`tenantAdmin.tabs.${id}`) }))}
            value={tab}
            onChange={(id) => setTab(id as Tab)}
            className="mb-6"
          />
          {/* Remounted per tenant, so a form never carries one tenant's values into another's. */}
          <div role="tabpanel" id={panelId} aria-label={t(`tenantAdmin.tabs.${tab}`)} key={`${tenant.id}-${tab}`}>
            {tab === 'orgs' ? <OrgsPanel tenant={tenant} /> : null}
            {tab === 'teams' ? <TeamsPanel tenant={tenant} /> : null}
            {tab === 'users' ? <UsersPanel /> : null}
            {tab === 'branding' ? <BrandingPanel tenant={tenant} /> : null}
            {tab === 'domains' ? <DomainsPanel tenant={tenant} operator={Boolean(list?.operator)} /> : null}
          </div>
        </>
      ) : null}
    </>
  );
}
