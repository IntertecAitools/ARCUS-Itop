'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Bug, ChevronDown, Lightbulb, Plus } from 'lucide-react';
import { Menu, type MenuItem } from '@/components/overlays';
import { buttonClasses } from '@/components/ui';
import { routes } from '@/config';
import { usePermissions } from '@/features/auth';

/** Primary "+ Create ▾" button of the page header. Hidden without write rights. */
export function CreateMenuButton() {
  const { t } = useTranslation('problems');
  const router = useRouter();
  const { can } = usePermissions();

  const items: MenuItem[] = [];
  if (can('problem:write')) {
    items.push({
      id: 'problem',
      label: t('create.problem'),
      icon: <Bug className="size-4 text-text-muted" aria-hidden />,
      onSelect: () => router.push(routes.problems.new),
    });
  }
  if (can('knownerror:write')) {
    items.push({
      id: 'known-error',
      label: t('create.knownError'),
      icon: <Lightbulb className="size-4 text-text-muted" aria-hidden />,
      onSelect: () => router.push(routes.knownErrors.list({ new: 1 })),
    });
  }

  if (items.length === 0) return null;

  return (
    <Menu
      items={items}
      trigger={(props) => (
        <button type="button" className={buttonClasses('primary')} {...props}>
          <Plus className="size-4" aria-hidden />
          {t('create.label')}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      )}
    />
  );
}
