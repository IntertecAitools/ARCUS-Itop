'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { adminNav, findActiveNav, mainNav, routes, type NavItem } from '@/config';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';

export interface SidebarProps {
  pathname: string;
  /** rail: icons only under 1280px, full at xl · drawer: always full (mobile) */
  variant?: 'rail' | 'drawer';
  onNavigate?: () => void;
}

function NavLink({
  item,
  active,
  variant,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  variant: 'rail' | 'drawer';
  onNavigate?: () => void;
}) {
  const { t } = useTranslation('nav');
  const Icon = item.icon;
  const label = t(item.key);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        title={variant === 'rail' ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors',
          variant === 'rail' && 'justify-center xl:justify-start',
          active ? 'bg-primary-soft text-primary' : 'text-text-muted hover:bg-surface-muted hover:text-text',
        )}
      >
        <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className={variant === 'rail' ? 'sr-only xl:not-sr-only' : undefined}>{label}</span>
      </Link>
    </li>
  );
}

export function Sidebar({ pathname, variant = 'rail', onNavigate }: SidebarProps) {
  const { t } = useTranslation('nav');
  const active = findActiveNav(pathname);

  return (
    <nav aria-label={t('mainNavigation')} className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center px-5', variant === 'rail' && 'justify-center px-3 xl:justify-start xl:px-5')}>
        <Link href={routes.problems.dashboard} onClick={onNavigate} aria-label={t('home')}>
          <Logo showWordmark={variant === 'drawer'} className={variant === 'rail' ? 'xl:hidden' : undefined} />
          {variant === 'rail' && <Logo className="hidden xl:inline-flex" />}
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {mainNav.map((item) => (
            <NavLink key={item.key} item={item} active={active?.key === item.key} variant={variant} onNavigate={onNavigate} />
          ))}
        </ul>
        <p
          className={cn(
            'mt-6 mb-2 px-3 text-xs font-semibold tracking-wide text-text-muted uppercase',
            variant === 'rail' && 'sr-only xl:not-sr-only',
          )}
        >
          {t('administration')}
        </p>
        <ul className="space-y-1">
          {adminNav.map((item) => (
            <NavLink key={item.key} item={item} active={active?.key === item.key} variant={variant} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>
    </nav>
  );
}
