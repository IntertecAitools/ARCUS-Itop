import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { AuthCard } from '../components/AuthCard';
import { useAuthOptions } from '../hooks/usePasswordReset';
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
  const { data: options } = useAuthOptions();
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
    <AuthCard label="Sign in" intro="Sign in with your account." error={error} onSubmit={submit}>
      <label htmlFor="login" className="mb-1.5 block text-[13px] font-medium text-ink">
        Login
      </label>
      <Input
        id="login"
        autoComplete="username"
        autoFocus
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

      <Button type="submit" className="mt-8 h-12 w-full text-[14px]" loading={signIn.isPending}>
        Sign in
      </Button>

      {/* Offered only when the BFF can send email. */}
      {options?.passwordReset ? (
        <p className="mt-6 text-[14px]">
          <Link to="/forgot-password" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
            Forgot password?
          </Link>
        </p>
      ) : null}
    </AuthCard>
  );
}
