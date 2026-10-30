// tenant-admin: feature types. Mirror backend/src/platform/tenancy/tenant-admin.service.ts.

export interface TenantSummary {
  id: string;
  name: string;
  status: 'active' | 'disabled';
}

export interface TenantList {
  /** The platform operator manages every tenant; a customer administrator only their own. */
  operator: boolean;
  tenants: TenantSummary[];
}

export interface EmailDomain {
  domain: string;
  orgId: number;
}

export interface TenantBrandingView {
  productName?: string;
  accentColor?: string;
  logoUrl?: string;
}

export interface TenantDetail extends TenantSummary {
  hostnames: string[];
  emailDomains: EmailDomain[];
  branding: TenantBrandingView;
  orgs: { id: number; name: string }[];
}

export interface OrgRow {
  id: number;
  name: string;
  code: string;
  status: 'active' | 'inactive';
  parentId: number;
  parentName: string;
}

export interface TeamRow {
  id: number;
  name: string;
  email: string;
  status: 'active' | 'inactive';
  orgId: number;
  orgName: string;
  members: { id: number; name: string }[];
}

export interface PersonOption {
  id: number;
  name: string;
  email: string;
}

/** A branding change: an empty string clears that part. The logo is a data URL. */
export interface BrandingInput {
  productName?: string;
  accentColor?: string;
  logo?: string;
}
