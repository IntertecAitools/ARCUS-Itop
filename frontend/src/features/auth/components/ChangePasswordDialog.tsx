import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useChangePassword } from '../hooks/useSession';
import { changePasswordSchema } from '../schemas';

/** Changes the signed-in user's own password (local accounts). */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const change = useChangePassword();
  const [values, setValues] = useState({ current: '', next: '', confirm: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse(values);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setFormError(null);
    change.mutate({ current: values.current, next: values.next });
  };

  const error = formError ?? (change.error instanceof Error ? change.error.message : null);
  const field = (key: keyof typeof values, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={`pwd-${key}`} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
      </label>
      <Input
        id={`pwd-${key}`}
        type="password"
        autoComplete={autoComplete}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[color:var(--arcus-ink)]/25 px-4 py-10 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm rounded-panel border border-line bg-surface-raised shadow-overlay"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">Change password</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-control p-1 text-ink-muted hover:bg-surface-hover">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {change.isSuccess ? (
            <p role="status" className="text-[13px] text-good-ink">Your password has been changed.</p>
          ) : (
            <>
              {error ? (
                <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
                  {error}
                </div>
              ) : null}
              {field('current', 'Current password', 'current-password')}
              {field('next', 'New password', 'new-password')}
              {field('confirm', 'Repeat new password', 'new-password')}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {change.isSuccess ? 'Close' : 'Cancel'}
          </Button>
          {change.isSuccess ? null : (
            <Button type="submit" size="sm" loading={change.isPending}>
              Change password
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
