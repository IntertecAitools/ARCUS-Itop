import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Input, Select, Skeleton } from '@/components/ui';
import { ConditionRows, isComplete, useClassInfo, type Criterion } from '@/features/records';
import {
  useAuditCategory,
  useAuditOptions,
  useAuditOverview,
  useDeleteCategory,
  useSaveCategory,
} from '../api/audit.api';
import { ErrorNote, HINT, KeptCondition, LABEL, Section } from '../components/EditorParts';
import { deleteCategoryQuestion, runParam, toleranceProblem } from '../lib/editing';
import type { AuditCategoryForm, CategoryInput } from '../types';

/** `/audit/categories/new` creates a category; `/audit/categories/:id` edits one. */
export function CategoryEditorPage() {
  const { id = '' } = useParams();
  const { data: category, isLoading, isError, error } = useAuditCategory(id);
  if (id !== 'new' && isLoading) return <Skeleton className="h-96 w-full" />;
  if (id !== 'new' && (isError || !category)) {
    return <ErrorNote message={error instanceof Error ? error.message : 'This category could not be loaded.'} />;
  }
  return <CategoryEditor id={id} category={category} key={category?.id ?? 'new'} />;
}

function CategoryEditor({ id, category }: { id: string; category: AuditCategoryForm | undefined }) {
  const navigate = useNavigate();
  const save = useSaveCategory(id);
  const remove = useDeleteCategory();
  const { data: options } = useAuditOptions();
  const { data: overview } = useAuditOverview();

  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [recordType, setRecordType] = useState(category?.recordType ?? 'Server');
  const [conditions, setConditions] = useState<Criterion[]>(category?.conditions ?? []);
  const [keepCondition, setKeepCondition] = useState(category?.keptCondition ?? false);
  const [good, setGood] = useState(String(category?.tolerance.good ?? 5));
  const [warning, setWarning] = useState(String(category?.tolerance.warning ?? 25));
  const [domains, setDomains] = useState<number[]>(category?.domains ?? []);
  const [formError, setFormError] = useState<string | null>(null);
  const { data: classInfo } = useClassInfo(recordType);

  const hasRules = (category?.rules.length ?? 0) > 0;
  const typeLabel = options?.recordTypes.find((t) => t.name === recordType)?.label ?? recordType;

  // Conditions name fields of one record type; another type starts afresh.
  const changeRecordType = (next: string) => {
    setRecordType(next);
    setConditions([]);
    setKeepCondition(false);
  };

  const submit = (thenRun: boolean) => {
    const tolerance = { good: Number(good), warning: Number(warning) };
    const problem = !name.trim() ? 'Give the category a name.' : toleranceProblem(tolerance.good, tolerance.warning);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    const input: CategoryInput = {
      name: name.trim(),
      description: description.trim(),
      recordType,
      // Half-filled rows are left out, as in advanced search.
      conditions: conditions.filter((c) => isComplete(c, classInfo?.criteria?.[c.field]?.kind)),
      keepCondition,
      tolerance,
      domains,
    };
    save.mutate(input, {
      onSuccess: (saved) =>
        navigate(thenRun ? `/audit?run=${runParam({ kind: 'category', id: saved.id })}` : '/audit'),
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
          { label: category ? category.name : 'New category' },
        ]}
        title={category ? category.name : 'New audit category'}
        description="A category is a set of records; its rules check each of them."
        actions={
          <Link to="/audit" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft className="mr-1.5 size-4" />
            Audit
          </Link>
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      <Section title="Category">
        <div>
          <label htmlFor="category-name" className={LABEL}>
            Name
          </label>
          <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production servers" />
        </div>
        <div>
          <label htmlFor="category-description" className={LABEL}>
            Description
          </label>
          <Input id="category-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </Section>

      <Section title="Records checked" subtitle="The rules of this category run against these records.">
        <div className="sm:w-1/2">
          <label htmlFor="record-type" className={LABEL}>
            Kind of record
          </label>
          <Select
            id="record-type"
            value={recordType}
            disabled={hasRules}
            onChange={(e) => changeRecordType(e.target.value)}
            options={(options?.recordTypes ?? [{ name: recordType, label: typeLabel, ci: true }]).map((t) => ({
              value: t.name,
              label: t.label,
            }))}
          />
          {hasRules ? <p className={HINT}>Its rules are conditions on this kind of record, so it stays while it has rules.</p> : null}
        </div>
        <div>
          <span className={LABEL}>Only those where…</span>
          {classInfo ? (
            <ConditionRows
              info={classInfo}
              value={conditions}
              onChange={setConditions}
              // Fixed dates cannot be read back from iTop's query.
              exclude={(_, kind) => kind === 'date'}
              valueLabels={category?.valueLabels ?? {}}
              emptyText={`No conditions: every ${typeLabel} is checked.`}
            />
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
        </div>
        {keepCondition ? <KeptCondition onRemove={() => setKeepCondition(false)} /> : null}
      </Section>

      <Section title="Result" subtitle="How many records may fail before the category shows a warning, then needs work.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tolerance-good" className={LABEL}>
              Good up to (% failing)
            </label>
            <Input id="tolerance-good" type="number" min={0} max={100} value={good} onChange={(e) => setGood(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tolerance-warning" className={LABEL}>
              Warning up to (% failing)
            </label>
            <Input
              id="tolerance-warning"
              type="number"
              min={0}
              max={100}
              value={warning}
              onChange={(e) => setWarning(e.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section title="Domains" subtitle="The tabs of the Audit screen this category appears under.">
        {overview?.domains.length ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink">
            {overview.domains.map((d) => (
              <label key={d.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={domains.includes(d.id)}
                  onChange={() => setDomains((ids) => (ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id]))}
                />
                {d.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">No domains yet. Add them from the Audit screen.</p>
        )}
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {category ? (
          <Button
            variant="ghost"
            leadingIcon={<Trash2 className="size-4" />}
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(deleteCategoryQuestion(category))) {
                remove.mutate(category.id, { onSuccess: () => navigate('/audit', { replace: true }) });
              }
            }}
          >
            Delete category
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => submit(false)} loading={save.isPending}>
            {category ? 'Save changes' : 'Create category'}
          </Button>
          <Button leadingIcon={<Play className="size-4" aria-hidden />} onClick={() => submit(true)} loading={save.isPending}>
            Save and run
          </Button>
        </div>
      </div>
    </>
  );
}
