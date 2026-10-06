'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { routes } from '@/config';
import { toast } from '@/stores';
import { useCreateProblem } from '../api/problems';
import { ProblemForm } from '../components/ProblemForm';

export function ProblemNewPage() {
  const { t } = useTranslation('problems');
  const router = useRouter();
  const create = useCreateProblem();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumb={
          <Link href={routes.problems.list()} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
            <ArrowLeft className="size-4" aria-hidden />
            {t('detail.backToList')}
          </Link>
        }
        title={t('new.title')}
        subtitle={t('new.subtitle')}
      />
      <ProblemForm
        onCancel={() => router.back()}
        onSubmit={async (input) => {
          const created = await create.mutateAsync(input);
          toast.success(t('new.created', { ref: created.ref }));
          router.push(routes.problems.detail(created.id));
        }}
      />
    </div>
  );
}
