import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Input, Select, Skeleton } from '@/components/ui';
import { ConditionRows, isComplete, useClassInfo, type Criterion } from '@/features/records';
import { useAuditOverview, useAuditRule, useDeleteRule, useSaveRule } from '../api/audit.api';
import { ErrorNote, HINT, KeptCondition, LABEL, Section } from '../components/EditorParts';
import { runParam } from '../lib/editing';
import type { AuditRuleForm, RuleInput } from '../types';

/**
 * `/audit/rules/new?category=10` adds a rule to a category;
 * `/audit/rules/:id` edits one.
 */
export function RuleEditorPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { data: rule, isLoading, isError, error } = useAuditRule(id);
  const overview = useAuditOverview();
  if ((id !== 'new' && isLoading) || overview.isLoading) return <Skeleton className="h-96 w-full" />;
  if (id !== 'new' && (isError || !rule)) {
    return <ErrorNote message={error instanceof Error ? error.message : 'This rule could not be loaded.'} />;
  }
  const categoryId = rule?.categoryId ?? Number(params.get('category') ?? overview.data?.categories[0]?.id ?? 0);
  return <RuleEditor id={id} rule={rule} initialCategoryId={categoryId} key={rule?.id ?? 'new'} />;
}

function RuleEditor({
  id,
  rule,
  initialCategoryId,
}: {
  id: string;
  rule: AuditRuleForm | undefined;
  initialCategoryId: number;
}) {
  const navigate = useNavigate();
  const save = useSaveRule(id);
  const remove = useDeleteRule();
  const { data: overview } = useAuditOverview();
  const categories = overview?.categories ?? [];

  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [lists, setLists] = useState<'faulty' | 'valid'>(rule?.lists ?? 'faulty');
  const [conditions, setConditions] = useState<Criterion[]>(rule?.conditions ?? []);
  const [keepCondition, setKeepCondition] = useState(rule?.keptCondition ?? false);
  const [formError, setFormError] = useState<string | null>(null);

  const category = categories.find((c) => c.id === categoryId);
  // An existing rule's conditions are on its own query's record type, which
  // iTop lets be a parent of the category's (every FunctionalCI, say).
  const recordType = rule?.recordType ?? category?.recordType ?? '';
  const typeLabel = (rule ? rule.recordTypeLabel : category?.recordTypeLabel) || recordType;
  const { data: classInfo } = useClassInfo(recordType);

  // A rule only moves between categories that check the same kind of record;
  // a new one starts afresh when its category's kind changes.
  const homeType = categories.find((c) => c.id === rule?.categoryId)?.recordType;
  const choices = rule ? categories.filter((c) => c.recordType === homeType) : categories;
  const changeCategory = (next: number) => {
    const target = categories.find((c) => c.id === next);
    if (target?.recordType !== category?.recordType) {
      setConditions([]);
      setKeepCondition(false);
    }
    setCategoryId(next);
  };

  const submit = (thenRun: boolean) => {
    const complete = conditions.filter((c) => isComplete(c, classInfo?.criteria?.[c.field]?.kind));
    const problem = !category
      ? 'Choose the category this rule belongs to.'
      : !name.trim()
        ? 'Give the rule a name.'
        : complete.length === 0 && !keepCondition
          ? 'Add at least one condition.'
          : null;
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    const input: RuleInput = {
      categoryId,
      name: name.trim(),
      description: description.trim(),
      lists,
      conditions: complete,
      keepCondition,
    };
    save.mutate(input, {
      onSuccess: (saved) => navigate(thenRun ? `/audit?run=${runParam({ kind: 'rule', id: saved.id })}` : '/audit'),
    });
  };

  const error =
    formError ??
    (save.error instanceof Error ? save.error.message : remove.error instanceof Error ? remove.error.message : null);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Audit', to: '/audit' },
          ...(category ? [{ label: category.name, to: `/audit/categories/${category.id}` }] : []),
          { label: rule ? rule.name : 'New rule' },
        ]}
        title={rule ? rule.name : 'New audit rule'}
        description="A rule checks every record of its category: the ones it finds are either the faulty or the valid ones."
        actions={
          <Link to="/audit" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft className="mr-1.5 size-4" />
            Audit
          </Link>
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      {categories.length === 0 ? (
        <ErrorNote message="Create a category first: a rule checks the records of one category." />
      ) : null}

      <Section title="Rule">
        <div>
          <label htmlFor="rule-name" className={LABEL}>
            Name
          </label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Serial number filled in" />
        </div>
        <div>
          <label htmlFor="rule-description" className={LABEL}>
            Description
          </label>
          <Input id="rule-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="sm:w-1/2">
          <label htmlFor="rule-category" className={LABEL}>
            Category
          </label>
          <Select
            id="rule-category"
            value={String(categoryId)}
            onChange={(e) => changeCategory(Number(e.target.value))}
            options={choices.map((c) => ({ value: String(c.id), label: `${c.name} (${c.recordTypeLabel || c.recordType})` }))}
          />
          {rule ? <p className={HINT}>It can move to another category that checks the same kind of record.</p> : null}
        </div>
      </Section>

      <Section title="Check" subtitle={`Runs against every ${typeLabel} of the category.`}>
        <div className="flex flex-col gap-2 text-[13px] text-ink">
          {(
            [
              ['faulty', `It finds the faulty ${typeLabel} records: those matching the conditions fail`],
              ['valid', `It finds the valid ${typeLabel} records: those not matching the conditions fail`],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="lists" checked={lists === value} onChange={() => setLists(value)} />
              {label}
            </label>
          ))}
        </div>
        <div>
          <span className={LABEL}>Records where…</span>
          {classInfo ? (
            <ConditionRows
              info={classInfo}
              value={conditions}
              onChange={setConditions}
              // Fixed dates cannot be read back from iTop's query.
              exclude={(_, kind) => kind === 'date'}
              valueLabels={rule?.valueLabels ?? {}}
              emptyText="Add at least one condition."
            />
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
        </div>
        {keepCondition ? <KeptCondition onRemove={() => setKeepCondition(false)} /> : null}
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {rule ? (
          <Button
            variant="ghost"
            leadingIcon={<Trash2 className="size-4" />}
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the rule “${rule.name}”?`)) {
                remove.mutate(
                  { id: rule.id, categoryId: rule.categoryId },
                  { onSuccess: () => navigate('/audit', { replace: true }) },
                );
              }
            }}
          >
            Delete rule
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => submit(false)} loading={save.isPending}>
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
          <Button leadingIcon={<Play className="size-4" aria-hidden />} onClick={() => submit(true)} loading={save.isPending}>
            Save and run
          </Button>
        </div>
      </div>
    </>
  );
}
