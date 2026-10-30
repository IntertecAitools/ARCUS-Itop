// branding: feature types. Mirrors BrandingView in backend/src/platform/tenancy/tenant-admin.service.ts.

/** The look of the site this page is on: a tenant's, by host name or signed-in user. */
export interface Branding {
  tenantId: string;
  tenantName: string;
  productName?: string;
  /** "#rrggbb". */
  accentColor?: string;
  /** Under the API base: "/branding/logo/acme?v=…". */
  logoUrl?: string;
}
