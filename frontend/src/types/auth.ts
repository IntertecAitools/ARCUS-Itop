/** The signed-in user as returned by the BFF (/auth/login, /auth/me) */
export interface CurrentUser {
  id: string;
  login: string;
  name: string;
  /** Caption under the name in the topbar, e.g. ROLE_BUSINESS_ADMIN */
  roleCode: string;
  /** iTop profiles, e.g. "Administrator", "Problem Manager", "Support Agent" */
  profiles: string[];
  /** iTop Person linked to this user */
  personId: string;
  orgId: string;
}
