// auth: feature types.

/**
 * The signed-in user, as the BFF's `/auth/me` describes them. Mirrors
 * `PublicUser` in backend/src/platform/auth/auth.service.ts. It never carries
 * credentials: those stay in the BFF.
 */
export interface SessionUser {
  id: number;
  login: string;
  name: string;
  email: string;
  /** `staff` use these screens; `portal` are end users. */
  kind: 'staff' | 'portal';
  profiles: string[];
  isAdmin: boolean;
  contactId: number;
  orgId: number;
}
