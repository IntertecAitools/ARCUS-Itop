import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { ssoStartUrl } from '../api/auth.api';
import { AuthCard } from '../components/AuthCard';
import { MfaStep } from '../components/MfaStep';
import { useAuthOptions } from '../hooks/usePasswordReset';
import { usePendingMfa, useSession, useSignIn } from '../hooks/useSession';
import { signInSchema } from '../schemas';
import type { MfaStep as Step } from '../types';

/** Only same-app paths may be returned to after sign-in: no open redirect. */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/**
 * Sign-in for everyone who uses the platform. Accounts are iTop's (local,
 * LDAP or external); the BFF checks them, so nobody ever opens iTop to log in.
 *
 * Single sign-on, when the BFF offers it, leaves for the identity provider
 * and comes back here only when something is left to do: an authenticator
 * code (the pending step comes from /auth/me) or an error (`?sso_error=`).
 */
export function LoginPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: user } = useSession();
  const signIn = useSignIn();
  const { data: options } = useAuthOptions();
  const pending = usePendingMfa();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [mfaStep, setMfaStep] = useState<Step | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const next = safeNext(params.get('next'));
  const ssoError = params.get('sso_error');

  if (user) return <Navigate to={next} replace />;

  const step = mfaStep ?? pending.data ?? null;
  if (step) {
    return (
      <MfaStep
        step={step}
        onDone={() => navigate(next, { replace: true })}
        onRestart={() => {
          setMfaStep(null);
          setPassword('');
          signIn.reset();
          void pending.refetch();
        }}
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ login, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setFormError(null);
    if (ssoError) setParams((p) => (p.delete('sso_error'), p), { replace: true });
    signIn.mutate(parsed.data, {
      onSuccess: (result) => {
        if ('mfa' in result) setMfaStep(result.mfa.step);
        else navigate(next, { replace: true });
      },
    });
  };

  const error = formError ?? (signIn.error instanceof Error ? signIn.error.message : null) ?? ssoError;
  const sso = options?.sso ?? null;
  // With single sign-on for staff, the password form is for end users or
  // break-glass accounts only: it stays folded away until asked for.
  const passwordFolded = sso !== null && options?.passwordSignIn !== 'all' && !showPassword;

  return (
    <AuthCard
      label="Sign in"
      intro={sso ? 'Sign in with your work account.' : 'Sign in with your account.'}
      error={error}
      onSubmit={submit}
    >
      {sso ? (
        <>
          <a
            href={ssoStartUrl(next)}
            className="btn-brand flex h-12 w-full items-center justify-center rounded-control bg-brand text-[14px] font-medium text-on-brand shadow-xs hover:bg-brand-hover"
          >
            {sso.label}
          </a>
          {passwordFolded ? (
            <p className="mt-6 text-[14px]">
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                className="text-ink-secondary underline underline-offset-4 hover:text-ink"
              >
                {options?.passwordSignIn === 'break-glass' ? 'Emergency sign-in' : 'Sign in with a password'}
              </button>
            </p>
          ) : (
            <p className="my-6 text-center text-[13px] text-ink-muted">or with a password</p>
          )}
        </>
      ) : null}

      {passwordFolded ? null : (
        <>
          <label htmlFor="login" className="mb-1.5 block text-[13px] font-medium text-ink">
            Login
          </label>
          <Input
            id="login"
            autoComplete="username"
            autoFocus={!sso}
            className="h-11"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />

          <label htmlFor="password" className="mt-5 mb-1.5 block text-[13px] font-medium text-ink">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button
            type="submit"
            variant={sso ? 'secondary' : 'primary'}
            className="mt-8 h-12 w-full text-[14px]"
            loading={signIn.isPending}
          >
            Sign in
          </Button>
        </>
      )}

      {/* Offered only when the BFF can send email. */}
      {options?.passwordReset && !passwordFolded ? (
        <p className="mt-6 text-[14px]">
          <Link to="/forgot-password" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
            Forgot password?
          </Link>
        </p>
      ) : null}
    </AuthCard>
  );
}
