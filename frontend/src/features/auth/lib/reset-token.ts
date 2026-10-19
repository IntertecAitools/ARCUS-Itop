/**
 * The token from a reset link. It arrives in the fragment
 * (`/reset-password#token=…`), which browsers never send to a server, so it
 * stays out of access logs and Referer headers.
 */
export function readResetToken(hash: string): string {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('token') ?? '';
  return /^[\w-]{20,200}$/.test(token) ? token : '';
}

export const MIN_PASSWORD_LENGTH = 8;

/** Why a new password cannot be used yet, or null when it can. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
