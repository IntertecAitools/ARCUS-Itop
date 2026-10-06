'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { Card } from '@/components/data-display';
import { PageHeader } from '@/components/layout';
import { Modal } from '@/components/overlays';
import { Button, Input, Select } from '@/components/ui';
import { routes } from '@/config';
import { usePermissions } from '@/features/auth';
import { useDebounce } from '@/hooks';
import { toast } from '@/stores';
import { useCreateKnownError, useKnownErrors } from '../api/knownErrors';
import { KnownErrorForm } from '../components/KnownErrorForm';
import { KnownErrorTable } from '../components/KnownErrorTable';
import { knownErrorDomains } from '../schemas';
import type { KnownErrorDomain } from '../types';

export function KnownErrorListPage() {
  const { t } = useTranslation('knowledgeBase');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = usePermissions();
  const createKnownError = useCreateKnownError();
  // "+ Create ▾ → Known error" links here with ?new=1
  const [creating, setCreating] = useState(params.get('new') === '1' && can('knownerror:write'));

  const domainParam = params.get('domain');
  const domain = knownErrorDomains.includes(domainParam as KnownErrorDomain) ? (domainParam as KnownErrorDomain) : undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Number(params.get('pageSize')) || 10;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounce(search.trim(), 300);

  function setParams(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function closeCreate() {
    setCreating(false);
    if (params.get('new')) setParams({ new: undefined });
  }

  // Debounced search text → URL (resets to page 1)
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) setParams({ q: q || undefined, page: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const { data, isLoading } = useKnownErrors({
    q: params.get('q') ?? undefined,
    domain,
    problemId: params.get('problemId') ?? undefined,
    page,
    pageSize,
  });

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('listTitle')}
        subtitle={t('listSubtitle')}
        actions={
          can('knownerror:write') && (
            <Button leftIcon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              {t('new')}
            </Button>
          )
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="min-w-60 flex-1">
            <label htmlFor="ke-search" className="sr-only">
              {t('kedbSearch.label')}
            </label>
            <Input
              id="ke-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('kedbSearch.placeholder')}
              leftIcon={<Search className="size-4" aria-hidden />}
            />
          </div>
          <label className="sr-only" htmlFor="ke-domain">
            {t('fields.domain')}
          </label>
          <Select
            id="ke-domain"
            className="w-48"
            value={domain ?? ''}
            placeholder={t('allDomains')}
            options={knownErrorDomains.map((d) => ({ value: d, label: t(`domain.${d}`) }))}
            onChange={(e) => setParams({ domain: e.target.value || undefined, page: undefined })}
          />
        </div>
        <KnownErrorTable
          rows={data?.items ?? []}
          loading={isLoading}
          pagination={{
            page,
            pageSize,
            total: data?.total ?? 0,
            onPageChange: (p) => setParams({ page: String(p) }),
            onPageSizeChange: (s) => setParams({ pageSize: String(s), page: undefined }),
          }}
        />
      </Card>

      <Modal
        open={creating}
        onClose={closeCreate}
        title={t('new')}
        size="lg"
      >
        <KnownErrorForm
          submitLabel={t('create')}
          onCancel={closeCreate}
          onSubmit={async (input) => {
            const created = await createKnownError.mutateAsync(input);
            toast.success(t('created', { name: created.name }));
            setCreating(false);
            router.push(routes.knownErrors.detail(created.id));
          }}
        />
      </Modal>
    </>
  );
}
