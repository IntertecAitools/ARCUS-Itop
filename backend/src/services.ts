import type { Config } from "./config/env.js";
import { ItopClient, type Logger } from "./itop/client.js";
import { CmdbSchema } from "./schema/load.js";
import { AttachmentsService } from "./modules/attachments/attachments.service.js";
import { DashboardService } from "./modules/dashboard/index.js";
import { DirectoryService } from "./modules/directory/index.js";
import { IncidentsService } from "./modules/incidents/index.js";
import { LookupsService } from "./platform/lookups/lookups.service.js";
import { Navigation } from "./platform/navigation/navigation.service.js";
import { Dashboards } from "./platform/dashboards/dashboards.service.js";
import { ObjectsService } from "./platform/objects/objects.service.js";
import { RelationsService } from "./shared/relations.service.js";
import { HistoryService } from "./platform/history/history.service.js";
import { TransferService } from "./platform/transfer/transfer.service.js";
import { AuthService } from "./platform/auth/auth.service.js";
import { createPool, type Pool } from "mysql2/promise";
import { MySqlSessionStore } from "./platform/auth/session.mysql.js";
import { MemorySessionStore, type SessionStore } from "./platform/auth/session.store.js";
import { type Mailer, SmtpMailer } from "./platform/auth/mailer.js";
import { PasswordResetService } from "./platform/auth/password-reset.service.js";
import {
  MemoryResetTokenStore,
  MySqlResetTokenStore,
  type ResetTokenStore,
} from "./platform/auth/reset-token.store.js";
import { UsersService } from "./platform/admin/users.service.js";
import { NotificationsService } from "./platform/admin/notifications.service.js";
import { AuditService } from "./platform/admin/audit.service.js";
import { QueriesService } from "./platform/queries/queries.service.js";
import { InboxService } from "./platform/inbox/inbox.service.js";
import { PortalService } from "./platform/portal/portal.service.js";
import { DefaultOrganization } from "./shared/default-organization.js";
import { CurrentContact } from "./shared/current-contact.js";
import { TenantScopedClient } from "./platform/tenancy/scoped-client.js";
import { TenantResolver } from "./platform/tenancy/resolve.js";
import { MemoryTenantStore, MySqlTenantStore, type TenantStore } from "./platform/tenancy/tenant.store.js";

export interface Services {
  config: Config;
  schema: CmdbSchema;
  navigation: Navigation;
  dashboards: Dashboards;
  client: ItopClient;
  objects: ObjectsService;
  attachments: AttachmentsService;
  lookups: LookupsService;
  relations: RelationsService;
  history: HistoryService;
  transfer: TransferService;
  auth: AuthService;
  sessions: SessionStore;
  passwordReset: PasswordResetService;
  users: UsersService;
  notifications: NotificationsService;
  audit: AuditService;
  queries: QueriesService;
  inbox: InboxService;
  portal: PortalService;
  dashboard: DashboardService;
  incidents: IncidentsService;
  directory: DirectoryService;
  defaultOrganization: DefaultOrganization;
  currentContact: CurrentContact;
  tenancy: TenantResolver;
  tenantStore: TenantStore;
}

export interface BuildServicesOptions {
  /** Injected in tests to avoid real HTTP and real schema files. */
  client?: ItopClient;
  schema?: CmdbSchema;
  navigation?: Navigation;
  dashboards?: Dashboards;
  sessions?: SessionStore;
  resetTokens?: ResetTokenStore;
  /** Tenants for tests; otherwise from TENANTS_FILE or the BFF database. */
  tenants?: TenantStore;
  /** Stands in for SMTP in tests; otherwise built from PASSWORD_RESET settings. */
  mailer?: Mailer;
  logger?: Logger;
}

/**
 * Sessions and reset links: in memory, or in MySQL when SESSION_STORE=mysql
 * (one pool for both; the session store closes it).
 */
function buildStores(config: Config): { sessions: SessionStore; resetTokens: ResetTokenStore; pool?: Pool } {
  const { sessionStore: store, sessionIdleMs, sessionMaxMs } = config.auth;
  if (store.kind === "memory") {
    return {
      sessions: new MemorySessionStore(sessionIdleMs, sessionMaxMs),
      resetTokens: new MemoryResetTokenStore(),
    };
  }
  const pool = createPool({
    host: store.host,
    port: store.port,
    user: store.user,
    password: store.password,
    database: store.database,
    connectionLimit: 10,
  });
  return {
    sessions: new MySqlSessionStore(pool, store.secret, sessionIdleMs, sessionMaxMs),
    resetTokens: new MySqlResetTokenStore(pool),
    pool,
  };
}

/** Tenants: injected, from TENANTS_FILE, or in the BFF database (sharing the session pool). */
function buildTenantStore(config: Config, pool: Pool | undefined, injected?: TenantStore): TenantStore {
  if (injected) return injected;
  const tenancy = config.tenancy;
  if (!tenancy?.enabled) return new MemoryTenantStore();
  if (tenancy.tenantsFile) return MemoryTenantStore.fromFile(tenancy.tenantsFile);
  if (pool) return new MySqlTenantStore(pool);
  throw new Error("TENANCY=on needs SESSION_STORE=mysql or TENANTS_FILE.");
}

export function buildServices(config: Config, options: BuildServicesOptions = {}): Services {
  const schema = options.schema ?? CmdbSchema.fromFile(config.schemaPath);
  const navigation =
    options.navigation ?? Navigation.fromFile(config.navigationPath, schema);
  // Every service talks to iTop through the tenant guard: the one place
  // tenancy is enforced (platform/tenancy/scoped-client.ts).
  const client = new TenantScopedClient(options.client ?? new ItopClient(config, options.logger), schema).asClient();
  const objects = new ObjectsService(client, schema, config.itop.defaultComment, config.itop.timezone);
  const currentContact = new CurrentContact(client, config.itop.user);
  const defaultOrganization = new DefaultOrganization(
    objects,
    currentContact,
    config.defaultOrgId,
  );
  const auth = new AuthService(client);
  const stores = options.sessions && options.resetTokens ? undefined : buildStores(config);
  const sessions = options.sessions ?? stores!.sessions;
  const resetTokens = options.resetTokens ?? stores!.resetTokens;
  const tenantStore = buildTenantStore(config, stores?.pool, options.tenants);
  const tenancy = new TenantResolver(tenantStore, config.tenancy ?? { enabled: false, platformLogins: [] });
  const reset = config.auth.passwordReset;
  const mailer = options.mailer ?? (reset ? new SmtpMailer(reset) : undefined);
  const dashboards =
    options.dashboards ?? Dashboards.fromFile(config.dashboardsPath, objects, schema);
  const transfer = new TransferService(client, schema);

  return {
    config,
    schema,
    navigation,
    dashboards,
    client,
    objects,
    attachments: new AttachmentsService(objects, schema),
    lookups: new LookupsService(client, schema, config.lookupCacheTtlMs),
    relations: new RelationsService(client, schema),
    history: new HistoryService(client, schema, config.itop.timezone),
    transfer,
    queries: new QueriesService(client, schema, objects, transfer),
    auth,
    sessions,
    passwordReset: new PasswordResetService(client, auth, resetTokens, sessions, mailer, reset),
    notifications: new NotificationsService(
      client,
      schema,
      config.appBaseUrl,
      config.notificationSender,
      config.itop.timezone,
    ),
    inbox: new InboxService(client, config.itop.timezone),
    audit: new AuditService(client, schema),
    users: new UsersService(client, objects, auth, sessions, tenancy),
    portal: new PortalService(client, schema, objects),
    dashboard: new DashboardService(objects, navigation, currentContact, schema),
    defaultOrganization,
    currentContact,
    incidents: new IncidentsService(objects, schema, defaultOrganization),
    directory: new DirectoryService(objects),
    tenancy,
    tenantStore,
  };
}

export {
  ObjectsService,
  LookupsService,
  RelationsService,
  DashboardService,
  IncidentsService,
  DirectoryService,
};
