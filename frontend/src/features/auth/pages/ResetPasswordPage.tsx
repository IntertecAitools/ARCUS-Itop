import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, buttonClasses, Input } from '@/components/ui';
import { AuthCard, AuthNotice } from '../components/AuthCard';
import { useResetPassword } from '../hooks/usePasswordReset';
import { newPasswordProblem, readResetToken } from '../lib/reset-token';

/** Where a reset email's link lands: choose a new password, then sign in. */
export function ResetPasswordPage() {
  // Read once, then dropped from the address bar so it does not linger in
  // history or get copied along with the URL.
  const [token] = useState(() => readResetToken(window.location.hash));
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    reset.mutate({ token, password });
  };

  const error = formError ?? (reset.error instanceof Error ? reset.error.message : null);

  if (!token) {
    return (
      <AuthCard label="Reset password" intro="This link is not complete.">
        <p className="text-[13px] text-ink-secondary">
          Open the link from the email again, or ask for a new one.
        </p>
        <p className="mt-5 text-center text-[13px]">
          <Link to="/forgot-password" className="font-medium text-brand-ink hover:underline">
            Ask for a new link
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthCard label="Reset password" intro="Your password has been changed.">
        <AuthNotice>You were signed out everywhere. Sign in with your new password.</AuthNotice>
        <Link
          to="/login"
          className={buttonClasses({ fullWidth: true, className: 'mt-6' })}
        >
          Sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard label="Reset password" intro="Choose a new password." error={error} onSubmit={submit}>
      <label htmlFor="new-password" className="mb-1.5 block text-[13px] font-medium text-ink">
        New password
      </label>
      <Input
        id="new-password"
        type="password"
        autoComplete="new-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <label htmlFor="confirm-password" className="mt-4 mb-1.5 block text-[13px] font-medium text-ink">
        Type it again
      </label>
      <Input
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />

      <Button type="submit" className="mt-6 w-full" loading={reset.isPending}>
        Set new password
      </Button>

      {reset.error ? (
        <p className="mt-5 text-center text-[13px]">
          <Link to="/forgot-password" className="font-medium text-brand-ink hover:underline">
            Ask for a new link
          </Link>
        </p>
      ) : null}
    </AuthCard>
  );
}
