'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Sidebar, Topbar } from '@/components/layout';
import { Drawer } from '@/components/overlays';
import { routes } from '@/config/routes';
import { useCurrentUser, useSignOut } from '@/features/auth';
import { useUiStore } from '@/stores';

/** Agent shell: 240px sidebar (icon rail < 1280px, drawer < 768px) + 64px topbar. */
export function AgentLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation('nav');
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const signOut = useSignOut();
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <div className="flex min-h-screen bg-bg">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-primary px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('skipToContent')}
      </a>

      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 border-r border-border bg-surface md:block xl:w-60">
        <Sidebar pathname={pathname} variant="rail" />
      </aside>

      <Drawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} label={t('mainNavigation')}>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="absolute top-4 right-3 rounded-chip p-1 text-text-muted hover:text-text"
          aria-label={t('closeMenu')}
        >
          <X className="size-5" aria-hidden />
        </button>
        <Sidebar pathname={pathname} variant="drawer" onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onMenuClick={() => setMobileNavOpen(true)}
          onSearch={(q) => router.push(routes.problems.list({ q }))}
          onSignOut={async () => {
            await signOut();
            router.replace(routes.login());
          }}
        />
        <main id="main" tabIndex={-1} className="page-backdrop flex-1 px-4 py-6 focus:outline-none md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
