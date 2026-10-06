'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, Pencil, SearchX } from 'lucide-react';
import { Card, DescriptionList } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses } from '@/components/ui';
import { routes } from '@/config';
import { usePermissions } from '@/features/auth';
import { isNotFound } from '@/lib/api-client';
import { toast } from '@/stores';
import { useKnownError, useUpdateKnownError } from '../api/knownErrors';
import { DomainBadge } from '../components/DomainBadge';
import { KnownErrorForm } from '../components/KnownErrorForm';
import { knownErrorToForm } from '../schemas';

function TextBlock({ text }: { text: string }) {
  return text ? <p className="text-sm whitespace-pre-line text-text">{text}</p> : <p className="text-sm text-text-muted">—</p>;
}

export function KnownErrorDetailPage() {
  const { t } = useTranslation('knowledgeBase');
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const { data: ke, isLoading, error } = useKnownError(id);
  const update = useUpdateKnownError(id);
  const [editing, setEditing] = useState(false);

  const back = (
    <Link href={routes.knownErrors.list()} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      {t('backToList')}
    </Link>
  );

  if (isNotFound(error)) {
    return (
      <Card>
        <EmptyState
          icon={SearchX}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
          action={
            <Link href={routes.knownErrors.list()} className={buttonClasses('secondary')}>
              {t('backToList')}
            </Link>
          }
        />
      </Card>
    );
  }

  if (isLoading || !ke) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={back}
        title={ke.name}
        subtitle={[ke.error_code, ke.org_name].filter(Boolean).join(' · ')}
        actions={
          can('knownerror:write') &&
          !editing && (
            <Button variant="secondary" leftIcon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
              {t('edit')}
            </Button>
          )
        }
      />

      {editing ? (
        <Card title={t('edit')}>
          <KnownErrorForm
            defaultValues={knownErrorToForm(ke)}
            submitLabel={t('save')}
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              await update.mutateAsync(input);
              toast.success(t('saved'));
              setEditing(false);
            }}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card title={t('sections.symptom')}>
              <TextBlock text={ke.symptom} />
            </Card>
            <Card title={t('sections.rootCause')}>
              <TextBlock text={ke.root_cause} />
            </Card>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card title={t('sections.workaround')}>
                <TextBlock text={ke.workaround} />
              </Card>
              <Card title={t('sections.solution')}>
                <TextBlock text={ke.solution} />
              </Card>
            </div>
          </div>
          <div className="space-y-6">
            <Card title={t('sections.properties')}>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  { label: t('fields.domain'), value: <DomainBadge domain={ke.domain} /> },
                  { label: t('fields.errorCode'), value: ke.error_code || '—' },
                  { label: t('fields.vendor'), value: ke.vendor || '—' },
                  { label: t('fields.model'), value: ke.model || '—' },
                  { label: t('fields.version'), value: ke.version || '—' },
                  { label: t('fields.org'), value: ke.org_name },
                  {
                    label: t('fields.problem'),
                    value: ke.problem_id ? (
                      <Link href={routes.problems.detail(ke.problem_id)} className="font-medium text-link hover:underline">
                        {ke.problem_ref}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                ]}
              />
            </Card>
            <Card title={t('fields.cis')}>
              {ke.ci_list.length === 0 ? (
                <p className="text-sm text-text-muted">{t('noCis')}</p>
              ) : (
                <ul className="space-y-2">
                  {ke.ci_list.map((ci) => (
                    <li key={ci.functionalci_id} className="text-sm">
                      <span className="font-medium text-text">{ci.functionalci_name}</span>
                      {ci.reason && <span className="block text-text-muted">{ci.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={t('sections.documents')}>
              {ke.document_list.length === 0 ? (
                <p className="text-sm text-text-muted">{t('noDocuments')}</p>
              ) : (
                <ul className="space-y-2">
                  {ke.document_list.map((doc) => (
                    <li key={doc.document_id} className="flex items-center gap-2 text-sm text-text">
                      <FileText className="size-4 text-text-muted" aria-hidden />
                      {doc.document_name}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
