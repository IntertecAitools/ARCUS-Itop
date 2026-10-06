import { X } from 'lucide-react';
import type { LookupOption } from '@/types';

/** Removable chips for multi-value lookups (CIs, contacts, incidents …). */
export function SelectedChips({
  items,
  onRemove,
  removeLabel,
}: {
  items: LookupOption[];
  onRemove: (id: string) => void;
  /** e.g. (label) => `Remove ${label}` */
  removeLabel: (label: string) => string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="inline-flex items-center gap-1 rounded-chip bg-primary-soft py-1 pr-1 pl-2 text-xs font-medium text-primary-hover"
        >
          {item.label}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={removeLabel(item.label)}
            className="rounded-chip p-0.5 hover:bg-surface"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
