import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Database } from 'lucide-react';

import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useClasses, useClassInfo, useCreateRecord } from '../api/useRecords';
import { humaniseAttcode } from '../components/FieldControls';
import { layoutFor, mustSupply, RecordForm } from '../components/RecordForm';
import type { RecordDto } from '../types';
import { DraftBar, DuplicateSuggestions, useTicketDraft } from '@/features/ticket-handling';
import { RequestFormSection, answersFor, missingRequired, type FormAnswers, type FormField } from '@/features/request-forms';

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
 *
 * Incidents are created here too, not on the shorter incident form: this one
 * carries every field iTop's schema offers (organisation, caller, CIs,
 * contacts…). The saved incident still opens on its own screen, because
 * `/records/Incident/<id>` redirects there.
 */
export function RecordNewPage() {
  const { className = '' } = useParams();
  const navigate = useNavigate();
  const { data: info, isLoading, isError, error } = useClassInfo(className);
  const create = useCreateRecord(className);
  const { data: classList } = useClasses();

  /**
   * For an abstract class, the concrete classes below it, which is what
   * iTop's console asks you to choose between on "New CI" or "New contact".
   */
  const concreteSubclasses = useMemo(
    () =>
      (classList?.classes ?? [])
        .filter((c) => !c.abstract && c.inherits.includes(className))
        .map((c) => c.name)
        .sort((a, b) => a.localeCompare(b)),
    [classList, className],
  );

  const [draft, setDraft] = useState<Record<string, string>>({});
  // A user request also asks its service's own questions (request forms).
  const isRequest = className === 'UserRequest';
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [answers, setAnswers] = useState<FormAnswers>({});
  // Tickets: a half-filled form can be saved and picked up later (?draft=…),
  // and open tickets that look the same are suggested while it is written.
  const ticketClass = className === 'Incident' || className === 'UserRequest' ? className : null;
  const ticketDraft = useTicketDraft(
    className === 'Incident' ? 'incident' : 'user-request',
    () => ({ fields: draft, answers }),
    (data) => {
      setDraft((data['fields'] as Record<string, string> | undefined) ?? {});
      setAnswers((data['answers'] as FormAnswers | undefined) ?? {});
    },
  );
  /**
   * Set only when the record was created but iTop refused some fields, which
   * is a real case: `priority` on a ticket is derived from impact and urgency,
   * so iTop accepts the row and ignores the value. Navigating straight away
   * would hide that the saved record is not quite what was typed.
   */
  const [partial, setPartial] = useState<CreateResult | null>(null);

  /**
   * Fields a create form should offer, in iTop's own order.
   *
   * Lifecycle attributes are excluded: iTop owns the starting state and
   * rejects an attempt to set it.
   */
  const offered = useMemo(() => {
    if (!info) return () => false;
    const writable = new Set(
      info.writable.filter((a) => ['scalar', 'picker'].includes(info.fields[a]?.ui ?? '')),
    );
    const lifecycle = info.lifecycle?.attribute;
    return (code: string) => writable.has(code) && code !== lifecycle;
  }, [info]);

  const fieldsets = useMemo(() => (info ? layoutFor(info, offered) : []), [info, offered]);
  const fields = useMemo(() => fieldsets.flatMap((f) => f.fields), [fieldsets]);

  const missing = useMemo(
    () => [
      ...fields.filter((a) => {
        const spec = info?.fields[a];
        return spec && mustSupply(spec) && !(draft[a] ?? '').trim();
      }),
      ...missingRequired(formFields, answers).map((f) => f.label),
    ],
    [fields, info, draft, formFields, answers],
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

    const formAnswers = formFields.length > 0 ? answersFor(formFields, answers) : undefined;
    create.mutate({ fields: payload, ...(formAnswers ? { formAnswers } : {}) }, {
      onSuccess: (result: CreateResult) => {
        if (result.rejected.length > 0) {
          setPartial(result);
          return;
        }
        if (ticketClass) ticketDraft.discard();
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
            title={`No record type called "${className}"`}
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

  // An abstract class has no table of its own: iTop's "New CI" and "New
  // contact" menus point at FunctionalCI and Contact and then ask which kind
  // of record to create. Offer the same choice.
  if (info.abstract) {
    return (
      <>
        <PageHeader
          breadcrumbs={crumbs}
          title={`New ${info.labels.class ?? className}`}
          description="Choose the kind of record to create."
        />
        {concreteSubclasses.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Database className="size-5" />}
              title={classList ? 'Nothing can be created here' : 'Loading…'}
              description={
                classList
                  ? `No concrete class extends ${className} in this instance.`
                  : undefined
              }
            />
          </Card>
        ) : (
          <Card>
            <CardBody>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {concreteSubclasses.map((name) => (
                  <li key={name}>
                    <Link
                      to={`/records/${name}/new`}
                      className="block rounded-card border border-line px-3 py-2.5 text-[13px] text-ink transition-colors hover:border-brand hover:bg-surface-hover"
                    >
                      {humaniseClass(name)}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={`New ${className}`}
        description={`${fields.filter((a) => mustSupply(info.fields[a] ?? {})).length} required of ${fields.length} fields`}
        actions={
          <Link
            to={`/records/${className}`}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            <ArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
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
              The record was created, but these fields were not accepted:
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

      <Card className="mb-4">
        <CardHeader
          title="Fields"
          subtitle={
            missing.length > 0
              ? `${missing.length} required field(s) still empty`
              : 'Ready to save'
          }
          action={
            <Button
              size="sm"
              onClick={submit}
              loading={create.isPending}
              disabled={missing.length > 0}
            >
              Create
            </Button>
          }
        />
      </Card>

      {ticketClass ? (
        <>
          <DraftBar draft={ticketDraft} className="mb-4" />
          <DuplicateSuggestions
            ticketClass={ticketClass}
            title={draft['title'] ?? ''}
            orgId={draft['org_id']}
            callerId={draft['caller_id']}
            serviceId={draft['service_id']}
            className="mb-4"
          />
        </>
      ) : null}

      {isRequest ? (
        <RequestFormSection
          audience="staff"
          serviceId={Number(draft['service_id']) || undefined}
          subcategoryId={Number(draft['servicesubcategory_id']) || undefined}
          answers={answers}
          onChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
          onFields={setFormFields}
          className="mb-4"
        />
      ) : null}

      <RecordForm
        info={info}
        fieldsets={fieldsets}
        editing
        draft={draft}
        onChange={(attcode, value) => setDraft((d) => ({ ...d, [attcode]: value }))}
      />
    </>
  );
}

/** `NetworkDevice` -> `Network device`, for a class with no label to hand. */
function humaniseClass(name: string) {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0) + spaced.slice(1).toLowerCase();
}
