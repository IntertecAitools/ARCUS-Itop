'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LoaderCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LookupOption } from '@/types';
import { controlClasses } from '@/components/ui';

export interface AsyncLookupSelectProps {
  id: string;
  value: LookupOption | null;
  onChange: (value: LookupOption | null) => void;
  /** Options for the current search text (provided by a feature lookup hook) */
  options: LookupOption[];
  loading?: boolean;
  /** Called with the raw search text; debounce in the caller */
  onSearch: (query: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Ids of options to hide (e.g. already linked items) */
  excludeIds?: string[];
  clearable?: boolean;
}

/** Props for feature lookup selects (OrgSelect, CiSelect …) that supply their own data. */
export type LookupSelectProps = Omit<AsyncLookupSelectProps, 'options' | 'loading' | 'onSearch'>;

/**
 * Typeahead select following the WAI-ARIA combobox pattern.
 * Data comes from props, so this component never calls the API itself.
 */
export function AsyncLookupSelect({
  id,
  value,
  onChange,
  options,
  loading,
  onSearch,
  onBlur,
  placeholder,
  disabled,
  invalid,
  describedBy,
  excludeIds,
  clearable = true,
}: AsyncLookupSelectProps) {
  const { t } = useTranslation();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const visible = excludeIds?.length ? options.filter((o) => !excludeIds.includes(o.id)) : options;
  const optionId = (index: number) => `${listId}-opt-${index}`;

  function openList() {
    if (disabled || open) return;
    setOpen(true);
    setQuery('');
    setActive(0);
    onSearch('');
  }

  function select(option: LookupOption) {
    onChange(option);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openList();
      else setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && visible[active]) {
        event.preventDefault();
        select(visible[active]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          onBlur?.();
        }
      }}
    >
      <input
        id={id}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && visible[active] ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        placeholder={placeholder ?? t('lookup.placeholder')}
        value={open ? query : (value?.label ?? '')}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
          setActive(0);
          onSearch(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(controlClasses, 'h-10 pr-16')}
      />
      <div className="absolute inset-y-0 right-2 flex items-center gap-1 text-text-muted">
        {loading && open && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label={t('lookup.clear')}
            onClick={() => onChange(null)}
            className="rounded-chip p-0.5 hover:text-text"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
        <ChevronDown className="size-4" aria-hidden />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-border bg-surface p-1 shadow-popover"
        >
          {visible.map((option, index) => (
            <li
              key={option.id}
              id={optionId(index)}
              role="option"
              aria-selected={value?.id === option.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => select(option)}
              className={cn(
                'flex cursor-pointer flex-col rounded-chip px-3 py-2 text-sm',
                index === active ? 'bg-primary-soft' : undefined,
                value?.id === option.id && 'font-semibold',
              )}
            >
              <span className="text-text">{option.label}</span>
              {option.hint && <span className="text-xs text-text-muted">{option.hint}</span>}
            </li>
          ))}
          {!loading && visible.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-text-muted">
              {t('lookup.noResults')}
            </li>
          )}
          {loading && visible.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-text-muted">
              {t('lookup.loading')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
