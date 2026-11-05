import { useEffect, useRef, useState } from 'react';
import { useFieldOptions } from '../api/useRecords';
import { pickerContext } from '../lib/picker-dependencies';
import type { FieldSpec } from '../types';
import { cn, dateTimeText, fromDateTimeInput, toDateTimeInput } from '@/lib/utils';

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
/** One entry of an iTop CaseLog. */
interface CaseLogEntry {
  date?: string;
  user_login?: string;
  message?: string;
}

export function FieldValue({
  spec,
  value,
  valueLabels,
}: {
  spec: FieldSpec;
  value: unknown;
  /** iTop's wording for this field's enum values, e.g. `new` -> "New". */
  valueLabels?: Record<string, string>;
}) {
  if (value === null || value === undefined || value === '' || value === '0') {
    return <span className="text-ink-muted">—</span>;
  }

  /**
   * A CaseLog is iTop's comment stream, not a string. It arrives as
   * `{ entries: [...] }`, which stringifies to "[object Object]" — so it is
   * rendered as the log it is.
   */
  if (spec.type === 'CaseLog') {
    const entries = (value as { entries?: CaseLogEntry[] })?.entries ?? [];
    if (entries.length === 0) return <span className="text-ink-muted">No entries</span>;
    return (
      <ul className="space-y-2">
        {entries.map((entry, i) => (
          <li key={`${entry.date ?? i}-${i}`} className="border-s-2 border-line ps-2.5">
            <p className="text-[11.5px] text-ink-muted">
              {[entry.user_login, entry.date ? dateTimeText(entry.date) : ''].filter(Boolean).join(' · ')}
            </p>
            <p className="whitespace-pre-wrap text-ink">{toText(String(entry.message ?? ''))}</p>
          </li>
        ))}
      </ul>
    );
  }

  /**
   * A Blob is iTop's file payload: `{data, mimetype, filename}` where `data`
   * is base64. Stringifying it prints "[object Object]", and printing `data`
   * would dump an entire file into the DOM as text. The file's identity is
   * what a reader wants; the bytes belong to the attachments panel, which can
   * actually download them.
   */
  if (spec.type === 'Blob' || spec.type === 'Image') {
    const file = value as { data?: string; mimetype?: string; filename?: string };
    if (!file?.filename && !file?.data) return <span className="text-ink-muted">—</span>;
    // base64 encodes 3 bytes as 4 characters, minus any padding.
    const base64 = file.data ?? '';
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
    return (
      <span className="text-ink">
        {file.filename || 'file'}
        <span className="ms-1.5 text-ink-muted">
          {[file.mimetype, bytes > 0 ? `${bytes} B` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
    );
  }

  const raw = String(value);

  if (spec.type === 'Text' || spec.type === 'HTML') {
    const text = toText(raw);
    return (
      <span className="block whitespace-pre-wrap text-ink">{text || <span className="text-ink-muted">—</span>}</span>
    );
  }

  if (spec.type === 'DateTime') {
    return <span className="text-ink tabular-nums">{dateTimeText(raw)}</span>;
  }

  if (spec.type === 'Boolean') {
    return <span className="text-ink">{raw === '1' || raw === 'true' ? 'Yes' : 'No'}</span>;
  }

  if (spec.values?.length) {
    // iTop's own label where it has one. Its enum ids are not always
    // humanisable: impact and urgency are stored as "1".."4".
    return <span className="text-ink">{valueLabels?.[raw] ?? humaniseAttcode(raw)}</span>;
  }

  return <span className="break-words text-ink">{raw}</span>;
}

/**
 * A dropdown of another class's records.
 *
 * The BFF sends at most 100 options, so a longer list (over a thousand customer
 * organizations) offers a search box to reach the rest. A chosen record keeps its
 * name when a later search no longer lists it.
 */
function PickerInput({
  id,
  className: itopClass,
  attcode,
  spec,
  value,
  onChange,
  formValues,
  waitingFor,
  currentLabel,
}: {
  id: string;
  className: string;
  attcode: string;
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  formValues?: Record<string, unknown>;
  waitingFor?: string;
  currentLabel?: string;
}) {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const context = pickerContext(itopClass, spec, formValues);
  const { data: picker, isPending, isPlaceholderData } = useFieldOptions(
    itopClass,
    attcode,
    { ...(q ? { q } : {}), context },
    !waitingFor,
  );
  const options = picker?.options ?? [];

  const seen = useRef(new Map<string, string>());
  for (const o of options) seen.current.set(String(o.id), o.label);
  const listed = options.some((o) => String(o.id) === value);
  const searchable = Boolean(picker?.truncated) || term !== '' || q !== '';
  // Waiting on the parent, or still showing the previous organization's people.
  const blocked = Boolean(waitingFor) || (isPending && !picker) || isPlaceholderData;

  return (
    <div className="space-y-1.5">
      {searchable && !waitingFor ? (
        <input
          type="search"
          aria-label={`Search ${humaniseAttcode(attcode)}`}
          className={CONTROL}
          placeholder="Type to search…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      ) : null}
      <select
        id={id}
        className={cn(CONTROL, 'appearance-none')}
        value={value}
        disabled={blocked}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{waitingFor ? `Choose ${waitingFor} first` : isPending ? 'Loading…' : 'Not set'}</option>
        {value && !listed ? (
          <option value={value}>{seen.current.get(value) ?? currentLabel ?? `#${value}`}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
      {picker?.truncated ? (
        <p className="text-[12px] text-ink-muted">
          Showing {options.length} of {picker.total.toLocaleString('en')}. Type above to find the rest.
        </p>
      ) : q && options.length === 0 && !isPlaceholderData ? (
        <p className="text-[12px] text-ink-muted">No matches.</p>
      ) : null}
    </div>
  );
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
  valueLabels,
  formValues,
  waitingFor,
  currentLabel,
}: {
  className: string;
  attcode: string;
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  /** iTop's wording for this field's enum values. */
  valueLabels?: Record<string, string>;
  /** The form's values, for a picker whose options depend on them. */
  formValues?: Record<string, unknown>;
  /** The label of the field to fill in first, when this picker depends on it. */
  waitingFor?: string;
  /** The name of the stored value, which a long list may not include. */
  currentLabel?: string;
}) {
  const id = `field-${attcode}`;

  if (spec.ui === 'picker') {
    return (
      <PickerInput
        id={id}
        className={itopClass}
        attcode={attcode}
        spec={spec}
        value={value}
        onChange={onChange}
        {...(formValues ? { formValues } : {})}
        {...(waitingFor ? { waitingFor } : {})}
        {...(currentLabel ? { currentLabel } : {})}
      />
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
            {valueLabels?.[v] ?? humaniseAttcode(v)}
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

  // The record holds an exact instant; the input shows and edits it on the
  // viewer's own clock, and hands back an instant again.
  if (spec.type === 'DateTime') {
    return (
      <input
        id={id}
        type="datetime-local"
        className={CONTROL}
        value={toDateTimeInput(value)}
        onChange={(e) => onChange(fromDateTimeInput(e.target.value))}
      />
    );
  }

  const inputType =
    spec.type === 'Integer' || spec.type === 'Decimal'
      ? 'number'
      : spec.type === 'Date'
        ? 'date'
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
