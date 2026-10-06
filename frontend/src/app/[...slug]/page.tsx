'use client';

import { notFound, usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@/components/feedback';
import { PageHeader } from '@/components/layout';
import { findPlaceholderNav } from '@/config/nav';

/** One placeholder page for every nav item whose module is not built yet. */
export default function PlaceholderPage() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const item = findPlaceholderNav(pathname);
  if (!item) notFound();
  const title = t(`nav:${item.key}`);
  return (
    <>
      <PageHeader title={title} />
      <ComingSoon title={t('placeholder.title', { module: title })} description={t('placeholder.description')} />
    </>
  );
}
