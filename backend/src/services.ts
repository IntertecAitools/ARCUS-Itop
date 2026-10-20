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
import { createPool } from "mysql2/promise";
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
import { InboxService } from "./platform/inbox/inbox.service.js";
import { PortalService } from "./platform/portal/portal.service.js";
import { DefaultOrganization } from "./shared/default-organization.js";
import { CurrentContact } from "./shared/current-contact.js";

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
  inbox: InboxService;
  portal: PortalService;
  dashboard: DashboardService;
  incidents: IncidentsService;
  directory: DirectoryService;
  defaultOrganization: DefaultOrganization;
  currentContact: CurrentContact;
}

export interface BuildServicesOptions {
  /** Injected in tests to avoid real HTTP and real schema files. */
  client?: ItopClient;
  schema?: CmdbSchema;
  navigation?: Navigation;
  dashboards?: Dashboards;
  sessions?: SessionStore;
  resetTokens?: ResetTokenStore;
  /** Stands in for SMTP in tests; otherwise built from PASSWORD_RESET settings. */
  mailer?: Mailer;
  logger?: Logger;
}

/**
 * Sessions and reset links: in memory, or in MySQL when SESSION_STORE=mysql
 * (one pool for both; the session store closes it).
 */
function buildStores(config: Config): { sessions: SessionStore; resetTokens: ResetTokenStore } {
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
  };
}

export function buildServices(config: Config, options: BuildServicesOptions = {}): Services {
  const schema = options.schema ?? CmdbSchema.fromFile(config.schemaPath);
  const navigation =
    options.navigation ?? Navigation.fromFile(config.navigationPath, schema);
  const client = options.client ?? new ItopClient(config, options.logger);
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
  const reset = config.auth.passwordReset;
  const mailer = options.mailer ?? (reset ? new SmtpMailer(reset) : undefined);
  const dashboards =
    options.dashboards ?? Dashboards.fromFile(config.dashboardsPath, objects, schema);

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
    transfer: new TransferService(client, schema),
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
    users: new UsersService(client, objects, auth, sessions),
    portal: new PortalService(client, schema, objects),
    dashboard: new DashboardService(objects, navigation, currentContact),
    defaultOrganization,
    currentContact,
    incidents: new IncidentsService(objects, schema, defaultOrganization),
    directory: new DirectoryService(objects),
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
