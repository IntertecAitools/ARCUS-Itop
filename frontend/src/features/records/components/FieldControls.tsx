import { useFieldOptions } from '../api/useRecords';
import type { FieldSpec } from '../types';
import { cn } from '@/lib/utils';

export const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted';

/** `first_name` -> `First name`. iTop attcodes are snake_case. */
export function humaniseAttcode(attcode: string) {
  return attcode
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** iTop stores Text and CaseLog as HTML; render it as text, never as markup. */
function toText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Renders one field's VALUE, chosen by its declared type.
 *
 * Deliberately conservative: anything unrecognised falls through to text
 * rather than guessing, because a wrong widget hides data.
 */
export function FieldValue({ spec, value }: { spec: FieldSpec; value: unknown }) {
  if (value === null || value === undefined || value === '' || value === '0') {
    return <span className="text-ink-muted">—</span>;
  }

  const raw = String(value);

  if (spec.type === 'Text' || spec.type === 'CaseLog' || spec.type === 'HTML') {
    const text = toText(raw);
    return (
      <span className="block whitespace-pre-wrap text-ink">{text || <span className="text-ink-muted">—</span>}</span>
    );
  }

  if (spec.type === 'Boolean') {
    return <span className="text-ink">{raw === '1' || raw === 'true' ? 'Yes' : 'No'}</span>;
  }

  if (spec.values?.length) {
    return <span className="text-ink">{humaniseAttcode(raw)}</span>;
  }

  return <span className="break-words text-ink">{raw}</span>;
}

/**
 * Renders one field's INPUT.
 *
 * Pickers fetch their options from the BFF on demand rather than up front:
 * a class can have a dozen of them, and iTop answers each in seconds.
 */
export function FieldInput({
  className: itopClass,
  attcode,
  spec,
  value,
  onChange,
}: {
  className: string;
  attcode: string;
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  const isPicker = spec.ui === 'picker';
  const { data: picker, isFetching } = useFieldOptions(itopClass, attcode, isPicker);

  const id = `field-${attcode}`;

  if (isPicker) {
    return (
      <select
        id={id}
        className={cn(CONTROL, 'appearance-none')}
        value={value}
        disabled={isFetching}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{isFetching ? 'Loading…' : 'Not set'}</option>
        {picker?.options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (spec.values?.length) {
    return (
      <select
        id={id}
        className={cn(CONTROL, 'appearance-none')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Not set</option>
        {spec.values.map((v) => (
          <option key={v} value={v}>
            {humaniseAttcode(v)}
          </option>
        ))}
      </select>
    );
  }

  if (spec.type === 'Text' || spec.type === 'CaseLog' || spec.type === 'HTML') {
    return (
      <textarea
        id={id}
        rows={4}
        className={CONTROL}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const inputType =
    spec.type === 'Integer' || spec.type === 'Decimal'
      ? 'number'
      : spec.type === 'Date'
        ? 'date'
        : spec.type === 'DateTime'
          ? 'datetime-local'
          : 'text';

  return (
    <input
      id={id}
      type={inputType}
      className={CONTROL}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
