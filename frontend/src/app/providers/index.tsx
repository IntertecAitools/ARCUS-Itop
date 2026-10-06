'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@/components/feedback';
import { AuthProvider } from './AuthProvider';
import { I18nProvider } from './I18nProvider';
import { QueryProvider } from './QueryProvider';
import { ThemeProvider } from './ThemeProvider';

function GlobalToaster() {
  const { t } = useTranslation();
  return <Toaster dismissLabel={t('actions.dismiss')} />;
}

/** Query · Theme · i18n · Auth, plus the global toast outlet. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <QueryProvider>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <GlobalToaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </I18nProvider>
  );
}
