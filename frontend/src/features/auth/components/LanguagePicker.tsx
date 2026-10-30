import { useId } from 'react';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isLanguage, LANGUAGES } from '@/lib/i18n';
import { useLanguage } from '../hooks/useLanguage';

/**
 * English ↔ العربية. A native select: keyboard and screen readers get it for
 * free, and each option is labelled in its own language (with `lang`), as a
 * reader of that language looks for it.
 */
export function LanguagePicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const id = useId();
  return (
    <div
      className={cn(
        'relative inline-flex h-9 items-center gap-1.5 rounded-control ps-2 pe-1 text-ink-secondary hover:bg-surface-hover hover:text-ink',
        className,
      )}
    >
      <Languages className="size-4 shrink-0" aria-hidden />
      <label htmlFor={id} className="sr-only">
        {t('shell.chooseLanguage')}
      </label>
      <select
        id={id}
        value={language}
        onChange={(e) => isLanguage(e.target.value) && void setLanguage(e.target.value)}
        className="h-8 cursor-pointer appearance-none rounded-control bg-transparent pe-1 text-[13px] font-medium text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--arcus-ring)]"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} className="bg-surface-raised text-ink">
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
