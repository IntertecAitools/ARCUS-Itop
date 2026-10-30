import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { PageIntro, publicControl } from '@/components/public';
import { RequestFormSection, answersFor, missingRequired, type FormAnswers, type FormField } from '@/features/request-forms';
import { DraftBar, useTicketDraft } from '@/features/ticket-handling';
import { useCatalog, useCreateRequest } from '../api/portal.api';

const CONTROL = publicControl;

const URGENCY = [
  { value: '4', label: 'portal.newRequest.urgencyLow' },
  { value: '3', label: 'portal.newRequest.urgencyMedium' },
  { value: '2', label: 'portal.newRequest.urgencyHigh' },
  { value: '1', label: 'portal.newRequest.urgencyCritical' },
];

/**
 * Raise a request: pick what it is about from the catalogue of services
 * the user's organisation is contracted for, then describe it. Files can be
 * attached on the request page once it exists.
 */
export function PortalNewRequestPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: services, isLoading } = useCatalog();
  const create = useCreateRequest();
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('4');
  // The chosen service's own questions, and the answers so far.
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const unanswered = missingRequired(formFields, answers);
  // A half-written request can be saved and finished later (?draft=…).
  const draft = useTicketDraft(
    'portal-request',
    () => ({ title, description, urgency, serviceId, subcategoryId, answers }),
    (data) => {
      setTitle(typeof data['title'] === 'string' ? data['title'] : '');
      setDescription(typeof data['description'] === 'string' ? data['description'] : '');
      setUrgency(typeof data['urgency'] === 'string' ? data['urgency'] : '4');
      setServiceId(typeof data['serviceId'] === 'number' ? data['serviceId'] : null);
      setSubcategoryId(typeof data['subcategoryId'] === 'number' ? data['subcategoryId'] : null);
      setAnswers((data['answers'] as FormAnswers | undefined) ?? {});
    },
  );

  const families = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof services>>();
    for (const s of services ?? []) {
      const key = s.family || t('portal.newRequest.otherServices');
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()];
  }, [services, t]);
  const service = services?.find((s) => s.id === serviceId);

  const submit = () =>
    create.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        urgency,
        ...(serviceId ? { serviceId } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
        ...(formFields.length > 0 ? { answers: answersFor(formFields, answers) } : {}),
      },
      {
        onSuccess: (ticket) => {
          draft.discard();
          navigate(`/portal/requests/${ticket.id}`, { replace: true });
        },
      },
    );

  return (
    <>
      <PageIntro title={t('portal.nav.new')} intro={t('portal.newRequest.intro')} />
      {create.isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {(create.error as Error).message}
        </div>
      ) : null}

      <Card className="mb-6">
        <CardHeader title={t('portal.newRequest.step1')} subtitle={t('portal.newRequest.step1Lead')} />
        <CardBody>
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : families.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{t('portal.newRequest.noServices')}</p>
          ) : (
            <div className="space-y-4">
              {families.map(([family, items]) => (
                <div key={family}>
                  <p className="mb-3 text-[12px] font-medium tracking-[0.14em] text-ink-secondary uppercase">{family}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={serviceId === s.id}
                        onClick={() => {
                          setServiceId(serviceId === s.id ? null : s.id);
                          setSubcategoryId(null);
                        }}
                        className={cn(
                          'h-full rounded-card border px-4 py-3.5 text-start transition-colors',
                          serviceId === s.id ? 'border-ink bg-brand-soft ring-1 ring-ink' : 'border-line-strong hover:bg-surface-hover',
                        )}
                      >
                        <span className="block text-[14px] font-medium text-ink">{s.name}</span>
                        {s.description ? <span className="mt-1 block text-[13px] text-ink-secondary line-clamp-2">{s.description}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {service && service.subcategories.length > 0 ? (
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink">{t('portal.newRequest.morePrecisely')}</p>
                  <div className="flex flex-wrap gap-2">
                    {service.subcategories.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        aria-pressed={subcategoryId === sc.id}
                        onClick={() => setSubcategoryId(subcategoryId === sc.id ? null : sc.id)}
                        className={cn(
                          'rounded-control border px-3 py-1.5 text-[13px]',
                          subcategoryId === sc.id ? 'border-ink bg-brand-soft text-ink ring-1 ring-ink' : 'border-line-strong text-ink hover:bg-surface-hover',
                        )}
                      >
                        {sc.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <RequestFormSection
        audience="portal"
        serviceId={serviceId ?? undefined}
        subcategoryId={subcategoryId ?? undefined}
        answers={answers}
        onChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
        onFields={setFormFields}
        title={t('portal.newRequest.formTitle')}
        controlClass={CONTROL}
        className="mb-6"
      />

      <Card className="mb-6">
        <CardHeader title={t('portal.newRequest.step2')} />
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="title" className="mb-1.5 block text-[13px] font-medium text-ink">{t('portal.newRequest.title')}</label>
            <Input id="title" className="h-11" placeholder={t('portal.newRequest.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="description" className="mb-1.5 block text-[13px] font-medium text-ink">{t('portal.newRequest.description')}</label>
            <textarea id="description" rows={6} className={CONTROL} placeholder={t('portal.newRequest.descriptionPlaceholder')} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label htmlFor="urgency" className="mb-1.5 block text-[13px] font-medium text-ink">{t('portal.newRequest.urgency')}</label>
            <select id="urgency" className={cn(CONTROL, 'h-11 sm:w-80')} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {URGENCY.map((u) => (
                <option key={u.value} value={u.value}>{t(u.label)}</option>
              ))}
            </select>
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-6">
        <DraftBar draft={draft} className="me-auto" />
        {unanswered.length > 0 ? (
          <p className="me-auto self-center text-[13px] text-ink-secondary">{t('portal.newRequest.stillToAnswer', { fields: unanswered.map((f) => f.label).join(', ') })}</p>
        ) : null}
        <Button
          size="lg"
          className="h-12 px-8 text-[14px]"
          onClick={submit}
          disabled={!title.trim() || !description.trim() || unanswered.length > 0}
          loading={create.isPending}
        >
          {t('portal.newRequest.submit')}
        </Button>
      </div>
    </>
  );
}
