'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, List, ListOrdered } from 'lucide-react';
import { cn, sanitizeHtml } from '@/lib/utils';

export interface RichTextProps {
  id: string;
  /** HTML */
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  labelledBy?: string;
  describedBy?: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  minHeightClass?: string;
}

/** Minimal HTML editor (bold, italic, lists) that produces the HTML iTop stores. */
export function RichText({
  id,
  value,
  onChange,
  onBlur,
  labelledBy,
  describedBy,
  placeholder,
  invalid,
  disabled,
  minHeightClass = 'min-h-32',
}: RichTextProps) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);

  // Push external value changes into the editor without moving the caret on every keystroke.
  useEffect(() => {
    const el = editorRef.current;
    if (el && el.innerHTML !== value) el.innerHTML = sanitizeHtml(value);
  }, [value]);

  function exec(command: string) {
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    document.execCommand(command, false);
    onChange(el.innerHTML);
  }

  const tools: Array<{ command: string; label: string; icon: ReactNode }> = [
    { command: 'bold', label: t('richText.bold'), icon: <Bold className="size-4" aria-hidden /> },
    { command: 'italic', label: t('richText.italic'), icon: <Italic className="size-4" aria-hidden /> },
    { command: 'insertUnorderedList', label: t('richText.bulletList'), icon: <List className="size-4" aria-hidden /> },
    { command: 'insertOrderedList', label: t('richText.numberedList'), icon: <ListOrdered className="size-4" aria-hidden /> },
  ];

  return (
    <div
      className={cn(
        'rounded-control border bg-surface transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
        invalid ? 'border-danger' : 'border-border',
        disabled && 'bg-surface-muted',
      )}
    >
      <div role="toolbar" aria-label={t('richText.toolbar')} className="flex gap-1 border-b border-border px-2 py-1">
        {tools.map((tool) => (
          <button
            key={tool.command}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(tool.command)}
            className="rounded-chip p-1.5 text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onBlur={onBlur}
        className={cn(
          'rich-text px-3 py-2 text-sm text-text focus:outline-none',
          'empty:before:text-text-muted empty:before:content-[attr(data-placeholder)]',
          minHeightClass,
        )}
      />
    </div>
  );
}
