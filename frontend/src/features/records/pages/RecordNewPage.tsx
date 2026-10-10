import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Database } from 'lucide-react';

import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useClassInfo, useCreateRecord } from '../api/useRecords';
import { FieldInput, humaniseAttcode } from '../components/FieldControls';
import type { RecordDto } from '../types';

/** What the BFF returns from a create: the row, plus anything iTop refused. */
interface CreateResult {
  object: RecordDto;
  rejected: { field: string; reason: string }[];
}

/**
 * Create a record of any class, rendered from the schema.
 *
 * This is what makes iTop's "New incident" / "New problem" / "New CI" menus
 * actually usable from here rather than being links to a screen that does not
 * exist. The record is created in iTop through the BFF, so there is no second
 * step in iTop's console.
 */
export function RecordNewPage() {
  const { className = '' } = useParams();
  const navigate = useNavigate();
  const { data: info, isLoading, isError, error } = useClassInfo(className);
  const create = useCreateRecord(className);

  const [draft, setDraft] = useState<Record<string, string>>({});
  /**
   * Set only when the record was created but iTop refused some fields, which
   * is a real case: `priority` on a ticket is derived from impact and urgency,
   * so iTop accepts the row and ignores the value. Navigating straight away
   * would hide that the saved record is not quite what was typed.
   */
  const [partial, setPartial] = useState<CreateResult | null>(null);

  /**
   * Fields a create form should offer.
   *
   * Required ones first, because they are what blocks the save, then the rest
   * in a stable order. Lifecycle attributes are excluded: iTop owns the
   * starting state and rejects an attempt to set it.
   */
  const fields = useMemo(() => {
    if (!info) return [];
    const writable = info.writable.filter((a) =>
      ['scalar', 'picker'].includes(info.fields[a]?.ui ?? ''),
    );
    const lifecycle = info.lifecycle?.attribute;
    const offered = writable.filter((a) => a !== lifecycle);
    const required = offered.filter((a) => info.fields[a]?.required);
    const optional = offered.filter((a) => !info.fields[a]?.required);
    return [...required, ...optional];
  }, [info]);

  const missing = useMemo(
    () => fields.filter((a) => info?.fields[a]?.required && !(draft[a] ?? '').trim()),
    [fields, info, draft],
  );

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Records', to: '/records' },
    { label: className, to: `/records/${className}` },
    { label: 'New' },
  ];

  const submit = () => {
    if (missing.length > 0) return;
    // Send only fields the user actually filled. An empty string is not the
    // same as "no value" to iTop, and blanking an untouched field would be a
    // silent edit the user never asked for.
    const payload: Record<string, unknown> = {};
    for (const attcode of fields) {
      const value = (draft[attcode] ?? '').trim();
      if (value !== '') payload[attcode] = value;
    }

    create.mutate(payload, {
      onSuccess: (result: CreateResult) => {
        if (result.rejected.length > 0) {
          setPartial(result);
          return;
        }
        navigate(`/records/${className}/${result.object.id}`);
      },
    });
  };

  if (isError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Unknown class" />
        <Card>
          <EmptyState
            icon={<Database className="size-5" />}
            title={`iTop has no class called "${className}"`}
            description={error instanceof Error ? error.message : undefined}
            action={
              <Link to="/records" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Back to records
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  if (isLoading || !info) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Loading…" />
        <Skeleton className="h-96" />
      </>
    );
  }

  // An abstract class has no table of its own, so there is nothing to create.
  // iTop's "New CI" menu points at abstract FunctionalCI and asks for the
  // subclass in its own UI; say that rather than offering a form that fails.
  if (info.abstract) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title={`New ${className}`} />
        <Card>
          <EmptyState
            icon={<Database className="size-5" />}
            title={`${className} is an abstract class`}
            description="It has no records of its own — pick one of the concrete classes that extend it."
            action={
              <Link to="/records" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Browse classes
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={`New ${className}`}
        description={`${fields.filter((a) => info.fields[a]?.required).length} required of ${fields.length} fields`}
        actions={
          <Link
            to={`/records/${className}`}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            <ArrowLeft className="mr-1.5 size-4" />
            All {className}
          </Link>
        }
      />

      {partial ? (
        <Card className="mb-4">
          <CardBody>
            <p className="text-[13px] font-semibold text-ink">
              Created {partial.object.label || `${className} #${partial.object.id}`}, with
              exceptions
            </p>
            <p className="mt-1 text-[12.5px] text-ink-secondary">
              iTop accepted the record but did not take these fields:
            </p>
            <ul className="mt-2 space-y-1">
              {partial.rejected.map((item) => (
                <li key={item.field} className="text-[12.5px] text-ink-secondary">
                  <span className="font-medium text-ink">{humaniseAttcode(item.field)}</span>
                  {' — '}
                  {item.reason}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Link
                to={`/records/${className}/${partial.object.id}`}
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                Open the record
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {create.isError ? (
        <div
          role="alert"
          className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          {create.error instanceof Error ? create.error.message : `Could not create the ${className}.`}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Fields"
          subtitle={missing.length > 0 ? `${missing.length} required field(s) still empty` : 'Ready to save'}
          action={
            <Button size="sm" onClick={submit} loading={create.isPending} disabled={missing.length > 0}>
              Create
            </Button>
          }
        />
        <CardBody>
          <dl className="divide-y divide-line">
            {fields.map((attcode) => {
              const spec = info.fields[attcode];
              if (!spec) return null;
              return (
                <div
                  key={attcode}
                  className="grid grid-cols-1 gap-1.5 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4"
                >
                  <dt className="text-[12.5px] text-ink-muted">
                    <label htmlFor={`field-${attcode}`}>{humaniseAttcode(attcode)}</label>
                    {spec.required ? <span className="ml-0.5 text-critical">*</span> : null}
                  </dt>
                  <dd className="min-w-0 text-[13px]">
                    <FieldInput
                      className={className}
                      attcode={attcode}
                      spec={spec}
                      value={draft[attcode] ?? ''}
                      onChange={(v) => setDraft((d) => ({ ...d, [attcode]: v }))}
                    />
                  </dd>
                </div>
              );
            })}
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
