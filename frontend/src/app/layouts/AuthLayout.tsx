import type { ReactNode } from 'react';

/** Centered card on the brand background (login, SSO callback). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="page-backdrop flex min-h-screen items-center justify-center bg-bg px-4 py-10">{children}</main>
  );
}
