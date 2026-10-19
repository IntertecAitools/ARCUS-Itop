import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { env } from '@/config/env';
import { useSession, useSignIn } from '../hooks/useSession';
import { signInSchema } from '../schemas';

/** Only same-app paths may be returned to after sign-in: no open redirect. */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/**
 * Sign-in for everyone who uses the platform. Accounts are iTop's (local,
 * LDAP or external); the BFF checks them, so nobody ever opens iTop to log in.
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: user } = useSession();
  const signIn = useSignIn();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const next = safeNext(params.get('next'));

  if (user) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ login, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setFormError(null);
    signIn.mutate(parsed.data, { onSuccess: () => navigate(next, { replace: true }) });
  };

  const error = formError ?? (signIn.error instanceof Error ? signIn.error.message : null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-panel border border-line bg-surface-raised p-6 shadow-overlay"
        aria-label="Sign in"
      >
        <h1 className="text-[18px] font-semibold text-ink">
          {env.appName} {env.platformName}
        </h1>
        <p className="mt-1 mb-5 text-[13px] text-ink-muted">Sign in with your account.</p>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
          >
            {error}
          </div>
        ) : null}

        <label htmlFor="login" className="mb-1.5 block text-[13px] font-medium text-ink">
          Login
        </label>
        <Input
          id="login"
          autoComplete="username"
          autoFocus
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />

        <label htmlFor="password" className="mt-4 mb-1.5 block text-[13px] font-medium text-ink">
          Password
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" className="mt-6 w-full" loading={signIn.isPending}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
