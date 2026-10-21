import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Card, CardHeader, IconButton, Input } from '@/components/ui';
import { useDeleteDomain, useSaveDomain } from '../api/audit.api';
import type { AuditDomain } from '../types';
import { ErrorNote } from './EditorParts';

/**
 * Domains group categories into the tabs of the Audit screen. Deleting one
 * keeps its categories; only their place under it goes.
 */
export function DomainsPanel({ domains, onClose }: { domains: AuditDomain[]; onClose: () => void }) {
  const save = useSaveDomain();
  const remove = useDeleteDomain();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');

  const startEdit = (target: AuditDomain | 'new') => {
    setEditing(target === 'new' ? 'new' : target.id);
    setName(target === 'new' ? '' : target.name);
    save.reset();
  };
  const submit = () => {
    if (!name.trim()) return;
    const existing = domains.find((d) => d.id === editing);
    save.mutate(
      { ...(existing ? { id: existing.id } : {}), name: name.trim(), description: existing?.description ?? '' },
      { onSuccess: () => setEditing(null) },
    );
  };
  const error = save.error ?? remove.error;

  const editor = (
    <div className="flex items-center gap-2">
      <Input
        aria-label="Domain name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setEditing(null);
        }}
        className="w-64"
      />
      <IconButton label="Save" size="sm" icon={<Check className="size-4" />} onClick={submit} disabled={save.isPending} />
      <IconButton label="Cancel" size="sm" icon={<X className="size-4" />} onClick={() => setEditing(null)} />
    </div>
  );

  return (
    <Card className="mb-4">
      <CardHeader
        title="Domains"
        subtitle="Each domain is a tab of this screen. Choose a category's domains when editing it."
        action={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        }
      />
      <div className="space-y-2 px-5 pb-4">
        {error ? <ErrorNote message={error instanceof Error ? error.message : 'This could not be saved.'} /> : null}
        {domains.map((d) =>
          editing === d.id ? (
            <div key={d.id}>{editor}</div>
          ) : (
            <div key={d.id} className="flex items-center gap-2 text-[13px] text-ink">
              <span className="min-w-0 flex-1 truncate">
                {d.name}
                <span className="ms-2 text-ink-muted">
                  {d.categories.length} {d.categories.length === 1 ? 'category' : 'categories'}
                </span>
              </span>
              <IconButton label={`Rename ${d.name}`} size="sm" icon={<Pencil className="size-4" />} onClick={() => startEdit(d)} />
              <IconButton
                label={`Delete ${d.name}`}
                size="sm"
                icon={<Trash2 className="size-4" />}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete the domain “${d.name}”? Its categories stay, outside it.`)) remove.mutate(d.id);
                }}
              />
            </div>
          ),
        )}
        {editing === 'new' ? (
          editor
        ) : (
          <Button size="sm" variant="secondary" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => startEdit('new')}>
            Add a domain
          </Button>
        )}
      </div>
    </Card>
  );
}
