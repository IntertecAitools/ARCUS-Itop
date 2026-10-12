import { Card, CardBody } from '@/components/ui';
import { cn } from '@/lib/utils';
import { FieldInput, FieldValue, humaniseAttcode } from './FieldControls';
import type { ClassInfo, Fieldset } from '../types';

/**
 * A record laid out the way iTop lays it out.
 *
 * iTop declares, per class, a set of columns holding titled fieldsets of
 * ordered fields — "General Information", "Qualification", "Dates" — and the
 * BFF publishes it. Rendering that is the difference between a form and *the*
 * form: alphabetical attribute codes put `agent_id` above `title` and scatter
 * the dates through the middle of the page.
 *
 * Falls back to a single fieldset when iTop declares no layout, which is true
 * of 11 of the 158 classes.
 */

export function fieldLabel(info: ClassInfo, attcode: string) {
  // iTop's wording wins; the humaniser is for the handful of attributes the
  // dictionary has no entry for.
  return info.labels?.fields?.[attcode] ?? humaniseAttcode(attcode);
}

/**
 * The read-only field that spells out a picker's value.
 *
 * iTop stores `org_id` as an integer and carries `org_name` beside it as an
 * ExternalField resolved through that key. Showing the key alone puts a bare
 * "1" on screen where a name belongs, so the pair is reunited here.
 */
export function mirrorOf(info: ClassInfo, attcode: string): string | undefined {
  let fallback: string | undefined;
  for (const [code, spec] of Object.entries(info.fields)) {
    if (spec.ui !== 'readonly' || spec.viaKey !== attcode) continue;
    // `name` / `friendlyname` is what a human reads; anything else resolved
    // through the same key is a detail of the far object.
    if (spec.viaAttribute === 'name' || spec.viaAttribute === 'friendlyname') return code;
    fallback ??= code;
  }
  return fallback;
}

/** The visible fieldsets for a class, honouring iTop's order. */
export function layoutFor(
  info: ClassInfo,
  include: (attcode: string) => boolean,
): Fieldset[] {
  const declared = info.presentation?.columns ?? [];

  if (declared.length > 0) {
    const used = new Set<string>();
    const sets: Fieldset[] = [];
    for (const column of declared) {
      for (const fieldset of column.fieldsets) {
        const fields = fieldset.fields.filter((code) => {
          if (used.has(code) || !include(code)) return false;
          used.add(code);
          return true;
        });
        if (fields.length > 0) sets.push({ ...fieldset, fields });
      }
    }

    // iTop's layout can omit attributes the class still has. Dropping them
    // would make a field invisible AND unsettable, so they are collected
    // rather than lost.
    //
    // Except the mirrors: iTop leaves `org_name` out of the form on purpose,
    // because it is already shown as the value of `org_id`. Listing them
    // would repeat every picker as a second, unexplained row.
    const mirrors = new Set(
      Object.keys(info.fields)
        .map((code) => mirrorOf(info, code))
        .filter((code): code is string => Boolean(code)),
    );
    const rest = Object.keys(info.fields)
      .filter((code) => include(code) && !used.has(code) && !mirrors.has(code))
      .sort();
    if (rest.length > 0) {
      sets.push({ id: 'other', label: 'Other', fields: rest });
    }
    return sets;
  }

  const all = Object.keys(info.fields).filter(include).sort();
  return all.length > 0 ? [{ id: 'all', label: 'Details', fields: all }] : [];
}

/** What to print for a field in display mode. */
function displayValue(
  info: ClassInfo,
  attcode: string,
  spec: { ui: string },
  values?: Record<string, unknown>,
) {
  if (spec.ui !== 'picker') return values?.[attcode];
  const mirror = mirrorOf(info, attcode);
  const text = mirror ? values?.[mirror] : undefined;
  // An unset picker has no mirror text either; fall through so the usual
  // em-dash is shown rather than a stray id.
  return text === undefined || text === null || text === '' ? values?.[attcode] : text;
}

function FieldRow({
  info,
  attcode,
  children,
}: {
  info: ClassInfo;
  attcode: string;
  children: React.ReactNode;
}) {
  const spec = info.fields[attcode];
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-3">
      <dt className="text-[12.5px] text-ink-muted">
        <label htmlFor={`field-${attcode}`}>{fieldLabel(info, attcode)}</label>
        {spec?.required ? <span className="ml-0.5 text-critical">*</span> : null}
      </dt>
      {/* `data-field` so a test can address one field's value without relying
          on label text, which repeats across fieldsets and tabs. */}
      <dd data-field={attcode} className="min-w-0 text-[13px]">
        {children}
      </dd>
    </div>
  );
}

export function RecordForm({
  info,
  fieldsets,
  editing,
  values,
  draft,
  onChange,
}: {
  info: ClassInfo;
  fieldsets: Fieldset[];
  /** Read-only display when false. */
  editing: boolean;
  /** Stored values, for display mode. */
  values?: Record<string, unknown>;
  /** Working copy, for edit mode. */
  draft?: Record<string, string>;
  onChange?: (attcode: string, value: string) => void;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        // Two columns once there is enough to be worth splitting. iTop uses
        // three; at our widths that makes every field a cramped column.
        fieldsets.length > 1 && 'lg:grid-cols-2',
      )}
    >
      {fieldsets.map((fieldset) => (
        <Card key={fieldset.id}>
          <CardBody>
            {/* `data-fieldset` so a test can assert iTop's grouping AND its
                order without matching on text that also appears as a tab. */}
            <p
              data-fieldset={fieldset.id}
              className="mb-1 text-[12px] font-semibold tracking-wide text-ink-muted uppercase"
            >
              {fieldset.label}
            </p>
            <dl className="divide-y divide-line">
              {fieldset.fields.map((attcode) => {
                const spec = info.fields[attcode];
                if (!spec) return null;
                return (
                  <FieldRow key={attcode} info={info} attcode={attcode}>
                    {editing ? (
                      <FieldInput
                        className={info.name}
                        attcode={attcode}
                        spec={spec}
                        value={draft?.[attcode] ?? ''}
                        onChange={(v) => onChange?.(attcode, v)}
                        valueLabels={info.labels?.values?.[attcode]}
                      />
                    ) : (
                      <FieldValue
                        spec={spec}
                        // A picker shows its mirror's text, falling back to the
                        // raw key when the class carries no mirror for it.
                        value={displayValue(info, attcode, spec, values)}
                        valueLabels={info.labels?.values?.[attcode]}
                      />
                    )}
                  </FieldRow>
                );
              })}
            </dl>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
