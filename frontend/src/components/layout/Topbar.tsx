'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronDown, CircleHelp, LogOut, Menu as MenuIcon, Search, Settings } from 'lucide-react';
import { useHotkeys } from '@/hooks';
import { initial } from '@/lib/utils';
import type { CurrentUser } from '@/types';
import { Menu } from '@/components/overlays';

export interface TopbarProps {
  user: CurrentUser | null;
  onSearch: (query: string) => void;
  onMenuClick: () => void;
  onSignOut: () => void;
  hasNotifications?: boolean;
}

const iconButton =
  'relative flex size-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-text';

export function Topbar({ user, onSearch, onMenuClick, onSignOut, hasNotifications = true }: TopbarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useHotkeys('mod+k', () => inputRef.current?.focus());

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) onSearch(query.trim());
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-4 md:px-6">
      <button type="button" onClick={onMenuClick} className={`${iconButton} md:hidden`} aria-label={t('topbar.openMenu')}>
        <MenuIcon className="size-5" aria-hidden />
      </button>

      <form role="search" onSubmit={submit} className="max-w-xl flex-1">
        <label htmlFor="global-search" className="sr-only">
          {t('topbar.searchLabel')}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            ref={inputRef}
            id="global-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('topbar.searchPlaceholder')}
            className="h-10 w-full rounded-full border border-border bg-surface-muted pr-16 pl-10 text-sm text-text placeholder:text-text-muted focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20 focus:outline-none"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-chip border border-border bg-surface px-1.5 text-[11px] font-medium text-text-muted sm:block">
            Ctrl K
          </kbd>
        </div>
      </form>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={iconButton} aria-label={t('topbar.notifications')}>
          <Bell className="size-5" aria-hidden />
          {hasNotifications && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-danger ring-2 ring-surface" aria-hidden />}
        </button>
        <button type="button" className={`${iconButton} hidden sm:flex`} aria-label={t('topbar.help')}>
          <CircleHelp className="size-5" aria-hidden />
        </button>
        <button type="button" className={`${iconButton} hidden sm:flex`} aria-label={t('topbar.settings')}>
          <Settings className="size-5" aria-hidden />
        </button>

        {user && (
          <Menu
            items={[
              {
                id: 'sign-out',
                label: t('topbar.signOut'),
                icon: <LogOut className="size-4" aria-hidden />,
                onSelect: onSignOut,
              },
            ]}
            trigger={(props) => (
              <button
                type="button"
                {...props}
                aria-label={t('topbar.userMenu', { name: user.name })}
                className="ml-2 flex items-center gap-3 rounded-control py-1 pr-2 pl-1 hover:bg-surface-muted"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white" aria-hidden>
                  {initial(user.name)}
                </span>
                <span className="hidden text-left lg:block">
                  <span className="block text-sm font-semibold text-text">{user.name}</span>
                  <span className="block text-[11px] tracking-wide text-text-muted">{user.roleCode}</span>
                </span>
                <ChevronDown className="hidden size-4 text-text-muted lg:block" aria-hidden />
              </button>
            )}
          />
        )}
      </div>
    </header>
  );
}
