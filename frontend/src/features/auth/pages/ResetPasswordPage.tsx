import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, buttonClasses, Input } from '@/components/ui';
import { AuthCard, AuthNotice } from '../components/AuthCard';
import { useResetPassword } from '../hooks/usePasswordReset';
import { newPasswordProblem, readResetToken } from '../lib/reset-token';

/** Where a reset email's link lands: choose a new password, then sign in. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
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
      <AuthCard label={t('auth.reset.title')} intro={t('auth.reset.incomplete')}>
        <p className="text-[15px] leading-6 text-ink-secondary">
          {t('auth.reset.incompleteHelp')}
        </p>
        <p className="mt-6 text-[14px]">
          <Link to="/forgot-password" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
            {t('auth.reset.askNew')}
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthCard label={t('auth.reset.title')} intro={t('auth.reset.changed')}>
        <AuthNotice>{t('auth.reset.signedOut')}</AuthNotice>
        <Link
          to="/login"
          className={buttonClasses({ fullWidth: true, className: 'mt-8 h-12 text-[14px]' })}
        >
          {t('auth.signIn')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard label={t('auth.reset.title')} intro={t('auth.reset.intro')} error={error} onSubmit={submit}>
      <label htmlFor="new-password" className="mb-1.5 block text-[13px] font-medium text-ink">
        {t('auth.reset.newPassword')}
      </label>
      <Input
        id="new-password"
        className="h-11"
        type="password"
        autoComplete="new-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <label htmlFor="confirm-password" className="mt-5 mb-1.5 block text-[13px] font-medium text-ink">
        {t('auth.reset.again')}
      </label>
      <Input
        id="confirm-password"
        className="h-11"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />

      <Button type="submit" className="mt-8 h-12 w-full text-[14px]" loading={reset.isPending}>
        {t('auth.reset.submit')}
      </Button>

      {reset.error ? (
        <p className="mt-6 text-[14px]">
          <Link to="/forgot-password" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
            {t('auth.reset.askNew')}
          </Link>
        </p>
      ) : null}
    </AuthCard>
  );
}
