import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, IconButton, Input, Select, Skeleton } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useRequestForm, useSaveRequestForm } from '../api/request-forms.api';
import { RequestFormFields } from '../components/RequestFormFields';
import { keyFromLabel, optionsToText, textToOptions } from '../lib/fields';
import type { FormAnswers, FormField, FormFieldType, FormScope } from '../types';

const TYPES: Array<{ value: FormFieldType; label: string }> = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'choice', label: 'Choice from a list' },
];

/** A question being edited: no key until it is first saved; options as text. */
interface Draft {
  key?: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string;
  help: string;
}

const toDraft = (f: FormField): Draft => ({
  key: f.key,
  label: f.label,
  type: f.type,
  required: f.required,
  options: optionsToText(f.options),
  help: f.help ?? '',
});

/** The drafts as fields, giving new questions a key from their label. */
function toFields(drafts: Draft[]): FormField[] {
  const taken = new Set(drafts.flatMap((d) => (d.key ? [d.key] : [])));
  return drafts.map((d) => {
    const key = d.key ?? keyFromLabel(d.label, taken);
    taken.add(key);
    return {
      key,
      label: d.label.trim(),
      type: d.type,
      required: d.required,
      ...(d.type === 'choice' ? { options: textToOptions(d.options) } : {}),
      ...(d.help.trim() ? { help: d.help.trim() } : {}),
    };
  });
}

/** Edit the questions one service or subcategory asks, with a live preview. */
export function RequestFormEditorPage() {
  const { scope: rawScope = 'service', id = '' } = useParams();
  const scope: FormScope = rawScope === 'subcategory' ? 'subcategory' : 'service';
  const { data: form, isLoading, isError, error } = useRequestForm(scope, id);
  const save = useSaveRequestForm(scope, id);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [preview, setPreview] = useState<FormAnswers>({});

  useEffect(() => {
    if (form && drafts === null) setDrafts(form.fields.map(toDraft));
  }, [form, drafts]);

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Request forms', to: '/request-forms' },
    { label: form?.targetName ?? '…' },
  ];

  if (isError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Request form" />
        <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'This form could not be loaded.'}
        </div>
      </>
    );
  }
  if (isLoading || !form || drafts === null) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Loading…" />
        <Skeleton className="h-96" />
      </>
    );
  }

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((list) => (list ?? []).map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const move = (i: number, by: number) =>
    setDrafts((list) => {
      const next = [...(list ?? [])];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });

  const problems = drafts.flatMap((d, i) => [
    ...(d.label.trim() ? [] : [`Question ${i + 1} needs a label.`]),
    ...(d.type === 'choice' && textToOptions(d.options).length === 0 ? [`"${d.label || `Question ${i + 1}`}" needs options.`] : []),
  ]);
  const fields = toFields(drafts.filter((d) => d.label.trim()));

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={form.targetName}
        description={
          scope === 'service'
            ? 'Asked whenever a request is raised for this service.'
            : 'Asked for this subcategory, after the service’s own questions.'
        }
        actions={
          <Link to="/request-forms" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
            All forms
          </Link>
        }
      />

      {save.isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {save.error instanceof Error ? save.error.message : 'The form could not be saved.'}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title="Questions"
            subtitle={
              problems[0] ??
              (form.updatedAt ? `Last saved ${dateTimeText(form.updatedAt)}${form.updatedBy ? ` by ${form.updatedBy}` : ''}` : 'Not saved yet')
            }
            action={
              <Button
                size="sm"
                loading={save.isPending}
                disabled={problems.length > 0}
                onClick={() => save.mutate(fields, { onSuccess: (saved) => setDrafts(saved.fields.map(toDraft)) })}
              >
                Save form
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {scope === 'subcategory' && form.inherited.length > 0 ? (
              <p className="rounded-control bg-surface-sunken px-3 py-2 text-[12.5px] text-ink-secondary">
                Also asked, from the service: {form.inherited.map((f) => f.label).join(', ')}.
              </p>
            ) : null}
            {drafts.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No questions yet: requests for this {scope} ask only for a title and description.</p>
            ) : null}
            {drafts.map((d, i) => (
              <fieldset key={d.key ?? `new-${i}`} className="rounded-card border border-line p-3">
                <legend className="sr-only">Question {i + 1}</legend>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-48 flex-1 text-[12.5px] font-medium text-ink">
                    Label
                    <Input className="mt-1" value={d.label} placeholder="e.g. Laptop model" onChange={(e) => update(i, { label: e.target.value })} />
                  </label>
                  <label className="text-[12.5px] font-medium text-ink">
                    Type
                    <Select className="mt-1 w-48" value={d.type} options={TYPES} onChange={(e) => update(i, { type: e.target.value as FormFieldType })} />
                  </label>
                  <label className="flex h-9 items-center gap-1.5 text-[13px] text-ink">
                    <input type="checkbox" checked={d.required} onChange={(e) => update(i, { required: e.target.checked })} />
                    Required
                  </label>
                  <div className="ms-auto flex gap-1">
                    <IconButton label="Move up" size="sm" icon={<ArrowUp className="size-4" />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton
                      label="Move down"
                      size="sm"
                      icon={<ArrowDown className="size-4" />}
                      disabled={i === drafts.length - 1}
                      onClick={() => move(i, 1)}
                    />
                    <IconButton
                      label="Remove question"
                      size="sm"
                      icon={<Trash2 className="size-4" />}
                      onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                    />
                  </div>
                </div>
                {d.type === 'choice' ? (
                  <label className="mt-2 block text-[12.5px] font-medium text-ink">
                    Options, one per line
                    <textarea
                      rows={3}
                      className="mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                      value={d.options}
                      onChange={(e) => update(i, { options: e.target.value })}
                    />
                  </label>
                ) : null}
                <label className="mt-2 block text-[12.5px] font-medium text-ink">
                  Help text (optional)
                  <Input className="mt-1" value={d.help} onChange={(e) => update(i, { help: e.target.value })} />
                </label>
              </fieldset>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={drafts.length >= 30}
              onClick={() => setDrafts([...drafts, { label: '', type: 'text', required: false, options: '', help: '' }])}
            >
              <Plus className="me-1.5 size-4" />
              Add question
            </Button>
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="Preview" subtitle="What people raising a request will see." />
          <CardBody>
            {fields.length === 0 && form.inherited.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Nothing extra is asked.</p>
            ) : (
              <RequestFormFields
                fields={[...form.inherited.filter((f) => !fields.some((g) => g.key === f.key)), ...fields]}
                answers={preview}
                onChange={(key, value) => setPreview((p) => ({ ...p, [key]: value }))}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
