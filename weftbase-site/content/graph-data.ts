export type Node = { id: string; label: string; tier: 0 | 1 | 2 };
export type Edge = { from: string; to: string };

// Sample estate. Fabricated, but shaped like a real one: a mislabelled test box
// quietly carrying production invoicing.
const nodes: Node[] = [
  { id: "esx-01", label: "ESX-01", tier: 0 },
  { id: "esx-02", label: "ESX-02", tier: 0 },
  { id: "san-a", label: "SAN-A", tier: 0 },
  { id: "sw-core", label: "SW-CORE-1", tier: 0 },

  { id: "app-test-04", label: "APP-TEST-04", tier: 1 },
  { id: "app-prod-01", label: "APP-PROD-01", tier: 1 },
  { id: "app-prod-02", label: "APP-PROD-02", tier: 1 },
  { id: "db-prod-01", label: "DB-PROD-01", tier: 1 },
  { id: "db-rep-01", label: "DB-REP-01", tier: 1 },
  { id: "web-01", label: "WEB-01", tier: 1 },
  { id: "web-02", label: "WEB-02", tier: 1 },
  { id: "file-01", label: "FILE-01", tier: 1 },
  { id: "auth-01", label: "AUTH-01", tier: 1 },
  { id: "mail-01", label: "MAIL-01", tier: 1 },

  { id: "invoicing", label: "Invoicing", tier: 2 },
  { id: "billing-api", label: "Billing API", tier: 2 },
  { id: "customer-portal", label: "Customer Portal", tier: 2 },
  { id: "orders", label: "Orders", tier: 2 },
  { id: "crm", label: "CRM", tier: 2 },
  { id: "reporting", label: "Reporting", tier: 2 },
  { id: "intranet", label: "Intranet", tier: 2 },
  { id: "sso", label: "Single sign-on", tier: 2 },
  { id: "notifications", label: "Notifications", tier: 2 },
  { id: "doc-store", label: "Document store", tier: 2 },
  { id: "payroll", label: "Payroll", tier: 2 },
  { id: "stock", label: "Stock control", tier: 2 },
];

const edges: Edge[] = [
  { from: "esx-01", to: "app-test-04" },
  { from: "esx-01", to: "app-prod-01" },
  { from: "esx-01", to: "web-01" },
  { from: "esx-01", to: "auth-01" },
  { from: "esx-02", to: "app-prod-02" },
  { from: "esx-02", to: "db-prod-01" },
  { from: "esx-02", to: "web-02" },
  { from: "esx-02", to: "mail-01" },
  { from: "san-a", to: "db-prod-01" },
  { from: "san-a", to: "db-rep-01" },
  { from: "san-a", to: "file-01" },
  { from: "sw-core", to: "web-01" },
  { from: "sw-core", to: "web-02" },

  // the point of the whole picture
  { from: "app-test-04", to: "invoicing" },
  { from: "app-test-04", to: "billing-api" },
  { from: "billing-api", to: "customer-portal" },
  { from: "invoicing", to: "payroll" },

  { from: "app-prod-01", to: "orders" },
  { from: "app-prod-01", to: "stock" },
  { from: "app-prod-02", to: "crm" },
  { from: "db-prod-01", to: "orders" },
  { from: "db-prod-01", to: "crm" },
  { from: "db-prod-01", to: "invoicing" },
  { from: "db-rep-01", to: "reporting" },
  { from: "web-01", to: "customer-portal" },
  { from: "web-02", to: "intranet" },
  { from: "auth-01", to: "sso" },
  { from: "sso", to: "customer-portal" },
  { from: "sso", to: "intranet" },
  { from: "mail-01", to: "notifications" },
  { from: "file-01", to: "doc-store" },
  { from: "doc-store", to: "intranet" },
];

export const GRAPH = { nodes, edges };
