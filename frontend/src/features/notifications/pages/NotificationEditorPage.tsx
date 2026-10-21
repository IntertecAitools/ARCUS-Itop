import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Input, Select, Skeleton } from '@/components/ui';
import { ConditionRows, isComplete, useClassInfo, type Criterion } from '@/features/records';
import { RecordPicker, type Option } from '@/features/users';
import { cn } from '@/lib/utils';
import { useDeleteRule, useRule, useRuleOptions, useSaveRule } from '../api/notifications.api';
import { describeEvent, EVENT_LABEL, insertToken, ROLE_LABEL } from '../lib/describe';
import type { EditableEvent, EmailStatus, Recipient, RecipientInput, Role, Rule, RuleInput } from '../types';

const LABEL = 'mb-1.5 block text-[13px] font-medium text-ink';
const HINT = 'mt-1 text-[12px] text-ink-muted';
const TEXTAREA =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

const EDITABLE: EditableEvent[] = ['created', 'updated', 'deleted', 'state_entered', 'state_left', 'sla_threshold'];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader title={title} {...(subtitle ? { subtitle } : {})} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

/** The editable state of one recipient list. */
interface RecipientState {
  roles: Role[];
  people: Option[];
  /** Indexes of parts set up in iTop that are still kept. */
  custom: number[];
}

const toState = (list: Recipient[]): RecipientState => ({
  roles: list.flatMap((r) => (r.kind !== 'people' && r.kind !== 'custom' ? [r.kind] : [])),
  people: list.flatMap((r) => (r.kind === 'people' ? r.people.map((p) => ({ id: p.id, label: p.name })) : [])),
  custom: list.flatMap((r) => (r.kind === 'custom' ? [r.index] : [])),
});

const toInput = (s: RecipientState): RecipientInput[] => [
  ...s.roles.map((kind) => ({ kind })),
  ...(s.people.length ? [{ kind: 'people' as const, ids: s.people.map((p) => p.id) }] : []),
  ...s.custom.map((index) => ({ kind: 'custom' as const, index })),
];

const EMPTY: RecipientState = { roles: [], people: [], custom: [] };

function RecipientPicker({
  label,
  value,
  onChange,
  roles,
}: {
  label: string;
  value: RecipientState;
  onChange: (v: RecipientState) => void;
  roles: Role[];
}) {
  const toggle = (role: Role) =>
    onChange({
      ...value,
      roles: value.roles.includes(role) ? value.roles.filter((r) => r !== role) : [...value.roles, role],
    });
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink">
        {roles.map((role) => (
          <label key={role} className="flex items-center gap-2">
            <input type="checkbox" checked={value.roles.includes(role)} onChange={() => toggle(role)} />
            {ROLE_LABEL[role]}
          </label>
        ))}
      </div>
      <RecordPicker
        className="Person"
        value={value.people}
        onChange={(people) => onChange({ ...value, people })}
        placeholder="Add specific people…"
      />
      {value.custom.length ? (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-secondary">
          <span>Also: a recipient list set up in iTop (kept as it is).</span>
          <button
            type="button"
            className="font-medium text-brand-ink hover:underline"
            onClick={() => onChange({ ...value, custom: [] })}
          >
            Remove it
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** `/notifications/new` creates a rule; `/notifications/:id` edits one. */
export function NotificationEditorPage() {
  const { id = '' } = useParams();
  const { data: rule, isLoading, isError, error } = useRule(id);
  if (id !== 'new' && isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (id !== 'new' && (isError || !rule)) {
    return (
      <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
        {error instanceof Error ? error.message : 'This rule could not be loaded.'}
      </div>
    );
  }
  return <RuleEditor id={id} rule={rule} key={rule?.id ?? 'new'} />;
}

function RuleEditor({ id, rule }: { id: string; rule: Rule | undefined }) {
  const navigate = useNavigate();
  const save = useSaveRule(id);
  const remove = useDeleteRule();

  const readOnlyEvent = rule ? !EDITABLE.includes(rule.event.kind as EditableEvent) : false;
  const [name, setName] = useState(rule?.name ?? '');
  const [kind, setKind] = useState<EditableEvent>(readOnlyEvent ? 'created' : ((rule?.event.kind as EditableEvent) ?? 'state_entered'));
  const [recordType, setRecordType] = useState(rule?.event.recordType ?? 'UserRequest');
  const [state, setState] = useState(rule?.event.state ?? '');
  const [fields, setFields] = useState<string[]>(rule?.event.fields ?? []);
  const [timer, setTimer] = useState(rule?.event.sla?.timer ?? 'ttr');
  const [percent, setPercent] = useState(rule?.event.sla?.percent ?? '75');
  const [to, setTo] = useState<RecipientState>(rule ? toState(rule.email.to) : { ...EMPTY, roles: ['caller'] });
  const [cc, setCc] = useState<RecipientState>(rule ? toState(rule.email.cc) : EMPTY);
  const [subject, setSubject] = useState(rule?.email.subject ?? '');
  const [body, setBody] = useState(rule?.email.body ?? '');
  const [status, setStatus] = useState<EmailStatus>(rule?.email.status ?? 'test');
  const [testRecipient, setTestRecipient] = useState(rule?.email.testRecipient ?? '');
  const [inAppOn, setInAppOn] = useState(rule?.inApp.on ?? true);
  const [inAppMessage, setInAppMessage] = useState(rule?.inApp.message ?? '');
  const [conditions, setConditions] = useState<Criterion[]>(rule?.event.conditions ?? []);
  const [keepCondition, setKeepCondition] = useState(rule?.event.keptCondition ?? false);
  const { data: classInfo } = useClassInfo(recordType);

  // Conditions name fields of one record type; another type starts afresh.
  const changeRecordType = (next: string) => {
    setRecordType(next);
    setConditions([]);
    setKeepCondition(false);
  };
  const [formError, setFormError] = useState<string | null>(null);

  const { data: options } = useRuleOptions(recordType);
  const typeLabel = options?.recordTypes.find((t) => t.name === recordType)?.label ?? recordType;

  // A record type without the chosen status or field resets those choices.
  useEffect(() => {
    if (!options?.states) return;
    if (state && !options.states.some((s) => s.code === state)) setState('');
    setFields((f) => f.filter((code) => options.fields?.some((x) => x.code === code)));
  }, [options, state]);

  // The last text box the user was in, so "Insert a field" knows where to put it.
  const lastFocus = useRef<'subject' | 'body'>('body');
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const insert = (token: string) => {
    if (!token) return;
    if (lastFocus.current === 'subject') {
      const el = subjectRef.current;
      const sel = el ? { start: el.selectionStart ?? subject.length, end: el.selectionEnd ?? subject.length } : null;
      const next = insertToken(subject, token, sel);
      setSubject(next.text);
      requestAnimationFrame(() => el?.setSelectionRange(next.cursor, next.cursor));
    } else {
      const el = bodyRef.current;
      const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
      const next = insertToken(body, token, sel);
      setBody(next.text);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(next.cursor, next.cursor);
      });
    }
  };

  const roles: Role[] = useMemo(() => {
    const available = options?.roles ?? [];
    return rule?.event.kind === 'mentioned' ? [...available, 'mentioned'] : available;
  }, [options, rule]);

  const summary = describeEvent(
    { kind, recordType, ...(state ? { state } : {}), fields, sla: { timer, percent } },
    {
      recordType: typeLabel,
      ...(state ? { state: options?.states?.find((s) => s.code === state)?.label ?? state } : {}),
      fields: fields.map((f) => options?.fields?.find((x) => x.code === f)?.label ?? f),
    },
  );

  const submit = () => {
    if (!readOnlyEvent && (kind === 'state_entered' || kind === 'state_left') && !state) {
      setFormError('Choose the status.');
      return;
    }
    setFormError(null);
    const input: RuleInput = {
      name: name.trim(),
      event: {
        kind,
        recordType,
        ...(kind === 'state_entered' || kind === 'state_left' ? { state } : {}),
        ...(kind === 'updated' ? { fields } : {}),
        ...(kind === 'sla_threshold' ? { sla: { timer, percent } } : {}),
        // Half-filled rows are left out, as in advanced search.
        conditions: conditions.filter((c) => isComplete(c, classInfo?.criteria?.[c.field]?.kind)),
        keepCondition,
      },
      email: {
        to: toInput(to),
        cc: toInput(cc),
        subject,
        body,
        status,
        ...(testRecipient.trim() ? { testRecipient: testRecipient.trim() } : {}),
      },
      inApp: { on: inAppOn, message: inAppMessage.trim() },
    };
    save.mutate(input, { onSuccess: (saved) => navigate(`/notifications/${saved.id}`, { replace: true }) });
  };

  const error = formError ?? (save.error instanceof Error ? save.error.message : remove.error instanceof Error ? remove.error.message : null);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Notifications', to: '/notifications' },
          { label: rule ? rule.name : 'New rule' },
        ]}
        title={rule ? rule.name : 'New notification rule'}
        description={rule ? describeEvent(rule.event) : 'Email people when something happens.'}
        actions={
          <Link to="/notifications" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
            All rules
          </Link>
        }
      />

      {error ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error}
        </div>
      ) : null}

      <Section title="Rule">
        <div>
          <label htmlFor="rule-name" className={LABEL}>
            Name
          </label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Request resolved: tell the caller" />
        </div>
      </Section>

      <Section title="When" subtitle={readOnlyEvent ? undefined : summary}>
        {readOnlyEvent && rule ? (
          <div className="flex gap-2 rounded-card border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {describeEvent(rule.event)}. This kind of rule was set up in iTop and fires only from iTop’s own
              screens, so nothing done in this platform triggers it. Its email can still be edited.
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="record-type" className={LABEL}>
                  A record of type
                </label>
                <Select
                  id="record-type"
                  value={recordType}
                  onChange={(e) => changeRecordType(e.target.value)}
                  options={(options?.recordTypes ?? [{ name: recordType, label: recordType, ticket: true }]).map((t) => ({
                    value: t.name,
                    label: t.label,
                  }))}
                />
              </div>
              <div>
                <label htmlFor="event-kind" className={LABEL}>
                  …that
                </label>
                <Select
                  id="event-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as EditableEvent)}
                  options={EDITABLE.filter((k) => k !== 'sla_threshold' || (options?.slaTimers?.length ?? 0) > 0)
                    .filter((k) => !(k === 'state_entered' || k === 'state_left') || (options?.states?.length ?? 0) > 0)
                    .map((k) => ({ value: k, label: EVENT_LABEL[k] }))}
                />
              </div>
            </div>

            {kind === 'state_entered' || kind === 'state_left' ? (
              <div className="sm:w-1/2">
                <label htmlFor="state" className={LABEL}>
                  Status
                </label>
                <Select
                  id="state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  options={[{ value: '', label: 'Choose a status…' }, ...(options?.states ?? []).map((s) => ({ value: s.code, label: s.label }))]}
                />
              </div>
            ) : null}

            {kind === 'updated' ? (
              <div>
                <span className={LABEL}>Only when one of these changes (none ticked: any change)</span>
                <div className="grid max-h-56 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto rounded-control border border-line p-3 text-[13px] text-ink sm:grid-cols-3">
                  {(options?.fields ?? []).map((f) => (
                    <label key={f.code} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={fields.includes(f.code)}
                        onChange={() => setFields(fields.includes(f.code) ? fields.filter((x) => x !== f.code) : [...fields, f.code])}
                      />
                      <span className="truncate">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {kind === 'sla_threshold' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sla-timer" className={LABEL}>
                    SLA timer
                  </label>
                  <Select
                    id="sla-timer"
                    value={timer}
                    onChange={(e) => setTimer(e.target.value)}
                    options={(options?.slaTimers ?? []).map((t) => ({
                      value: t.code,
                      label: t.code === 'tto' ? 'Time to own (TTO)' : t.code === 'ttr' ? 'Time to resolve (TTR)' : t.label,
                    }))}
                  />
                </div>
                <div>
                  <label htmlFor="sla-percent" className={LABEL}>
                    Reaches
                  </label>
                  <Select
                    id="sla-percent"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    options={(options?.slaPercents ?? ['75', '100']).map((p) => ({ value: p, label: `${p}% of the time allowed` }))}
                  />
                </div>
              </div>
            ) : null}

          </>
        )}
      </Section>

      {readOnlyEvent ? null : (
        <Section title="Only when…" subtitle="Optional. The email is sent only for records that meet every condition.">
          {classInfo ? (
            <ConditionRows
              info={classInfo}
              value={conditions}
              onChange={setConditions}
              // A trigger fires at one moment: a date window rarely means what it seems.
              exclude={(_, kind) => kind === 'date'}
              valueLabels={rule?.event.valueLabels ?? {}}
              emptyText="No conditions: every record of this type counts."
            />
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
          {keepCondition ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
              <span>Also: a condition set up in iTop that cannot be shown here. It is kept as it is.</span>
              <button type="button" className="font-medium text-brand-ink hover:underline" onClick={() => setKeepCondition(false)}>
                Remove it
              </button>
            </div>
          ) : null}
        </Section>
      )}

      <Section
        title="Email"
        subtitle={rule && rule.email.sharedWith > 0 ? `Also sent by ${rule.email.sharedWith} other rule${rule.email.sharedWith === 1 ? '' : 's'}: changes here apply to them too.` : 'Sent from the helpdesk address.'}
      >
        <RecipientPicker label="To" value={to} onChange={setTo} roles={roles} />
        <RecipientPicker label="Cc" value={cc} onChange={setCc} roles={roles} />

        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className={cn(HINT, 'mt-0')}>Fields are filled in from the record when the email is sent.</p>
          <Select
            aria-label="Insert a field"
            className="w-56"
            value=""
            onChange={(e) => insert(e.target.value)}
            options={[{ value: '', label: 'Insert a field…' }, ...(options?.tokens ?? []).map((t) => ({ value: t.token, label: t.label }))]}
          />
        </div>

        <div>
          <label htmlFor="subject" className={LABEL}>
            Subject
          </label>
          <Input
            id="subject"
            ref={subjectRef}
            value={subject}
            onFocus={() => (lastFocus.current = 'subject')}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Your request {{ref}} is resolved"
          />
        </div>
        <div>
          <label htmlFor="body" className={LABEL}>
            Message
          </label>
          <textarea
            id="body"
            ref={bodyRef}
            rows={9}
            className={TEXTAREA}
            value={body}
            onFocus={() => (lastFocus.current = 'body')}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'Hello {{caller}},\n\nYour request {{ref}} is resolved.\n\n{{link}}'}
          />
          <p className={HINT}>Plain text. A blank line starts a new paragraph. “Link to the record” opens it in this platform.</p>
        </div>
      </Section>

      <Section title="In the app" subtitle="A notification in the bell of the people in To, alongside the email.">
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={inAppOn} onChange={(e) => setInAppOn(e.target.checked)} />
          Also show it in the app’s bell
        </label>
        {inAppOn ? (
          <div>
            <label htmlFor="in-app-message" className={LABEL}>
              Short message
            </label>
            <Input
              id="in-app-message"
              value={inAppMessage}
              onChange={(e) => setInAppMessage(e.target.value)}
              placeholder="e.g. {{ref}} was assigned to you"
            />
            <p className={HINT}>The subject is its title. Fields work as in the email; clicking it opens the record here.</p>
          </div>
        ) : null}
      </Section>

      <Section title="Sending">
        <div className="flex flex-wrap gap-4 text-[13px] text-ink">
          {(
            [
              ['on', 'On: send to the recipients'],
              ['test', 'Test: send only to a test address'],
              ['off', 'Off: send nothing'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="status" checked={status === value} onChange={() => setStatus(value)} />
              {label}
            </label>
          ))}
        </div>
        <div className="sm:w-1/2">
          <label htmlFor="test-recipient" className={LABEL}>
            Test address
          </label>
          <Input
            id="test-recipient"
            type="email"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            placeholder="you@yourcompany.com"
          />
          <p className={HINT}>In test mode every email of this rule goes here instead.</p>
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {rule ? (
          <Button
            variant="ghost"
            leadingIcon={<Trash2 className="size-4" />}
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the rule “${rule.name}”? Its emails stop at once.`)) {
                remove.mutate(rule.id, { onSuccess: () => navigate('/notifications', { replace: true }) });
              }
            }}
          >
            Delete rule
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={submit} loading={save.isPending}>
          {rule ? 'Save changes' : 'Create rule'}
        </Button>
      </div>
    </>
  );
}
