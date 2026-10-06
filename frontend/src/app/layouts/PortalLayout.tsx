import type { ReactNode } from 'react';
import { Logo } from '@/components/layout';

/** Self-service portal shell (end users). Not used by Problem Management yet. */
export function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex h-16 items-center border-b border-border bg-surface px-6">
        <Logo />
      </header>
      <main className="page-backdrop mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
