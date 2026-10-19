import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { AuthCard, AuthNotice } from '../components/AuthCard';
import { useRequestPasswordReset } from '../hooks/usePasswordReset';

/**
 * Asks for a reset link by login or email. The answer never says whether an
 * account exists, so this page cannot be used to find out who has one.
 */
export function ForgotPasswordPage() {
  const request = useRequestPasswordReset();
  const [identifier, setIdentifier] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setFormError('Enter your login or email address.');
      return;
    }
    setFormError(null);
    request.mutate(identifier.trim());
  };

  const error = formError ?? (request.error instanceof Error ? request.error.message : null);

  return (
    <AuthCard
      label="Forgot password"
      intro="Enter your login or email address and we'll email you a link to choose a new password."
      error={error}
      onSubmit={submit}
    >
      {request.isSuccess ? (
        <AuthNotice>{request.data.message}</AuthNotice>
      ) : (
        <>
          <label htmlFor="identifier" className="mb-1.5 block text-[13px] font-medium text-ink">
            Login or email
          </label>
          <Input
            id="identifier"
            autoComplete="username"
            autoFocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
          <Button type="submit" className="mt-6 w-full" loading={request.isPending}>
            Send reset link
          </Button>
        </>
      )}

      <p className="mt-5 text-center text-[13px]">
        <Link to="/login" className="font-medium text-brand-ink hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
