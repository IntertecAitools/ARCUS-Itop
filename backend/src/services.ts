import type { Config } from "./config/env.js";
import { ItopClient, type Logger } from "./itop/client.js";
import { CmdbSchema } from "./schema/load.js";
import { AttachmentsService } from "./modules/attachments/attachments.service.js";
import { DashboardService } from "./modules/dashboard/index.js";
import { DirectoryService } from "./modules/directory/index.js";
import { IncidentsService, TicketExtras } from "./modules/incidents/index.js";
import {
  AnthropicRcaModel,
  ProblemsService,
  RcaEvidenceService,
  RcaService,
  type RcaModel,
} from "./modules/problems/index.js";
import { SlaService } from "./modules/sla/index.js";
import { BusinessHoursService } from "./modules/business-hours/index.js";
import { createMailSource, type MailSource, MailIntakeService } from "./modules/mail-intake/index.js";
import {
  type AssignmentRuleStore,
  DispatchService,
  MemoryAssignmentRuleStore,
  MySqlAssignmentRuleStore,
} from "./modules/dispatch/index.js";
import {
  ChangesService,
  MemoryPlanRuleStore,
  MySqlPlanRuleStore,
  type PlanRuleStore,
} from "./modules/changes/index.js";
import {
  MemoryRequestFormStore,
  MySqlRequestFormStore,
  RequestFormsService,
  type RequestFormStore,
} from "./modules/request-forms/index.js";
import {
  DataImportService,
  MemoryImportReportStore,
  MySqlImportReportStore,
  type ImportReportStore,
  SyncSourcesService,
} from "./modules/data-import/index.js";
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
import { ApprovalsService } from "./platform/approvals/approvals.service.js";
import { DefaultOrganization } from "./shared/default-organization.js";
import { CurrentContact } from "./shared/current-contact.js";
import { TenantScopedClient } from "./platform/tenancy/scoped-client.js";
import { TenantResolver } from "./platform/tenancy/resolve.js";
import { TenantAdminService } from "./platform/tenancy/tenant-admin.service.js";
import { tenantOfEmail } from "./platform/tenancy/tenant.store.js";
import { RegistrationService } from "./platform/portal/registration.service.js";
import { MemoryPreferencesStore, MySqlPreferencesStore, type PreferencesStore } from "./platform/auth/preferences.store.js";
import { MemoryTenantStore, MySqlTenantStore, type TenantStore } from "./platform/tenancy/tenant.store.js";
import { MemoryMfaStore, MySqlMfaStore, type MfaStore } from "./platform/auth/mfa.store.js";
import { MfaService } from "./platform/auth/mfa.service.js";
import { Sealer } from "./platform/auth/seal.js";
import { MemorySignInAudit, MySqlSignInAudit, type SignInAudit } from "./platform/auth/sign-in-audit.js";
import { SsoService } from "./platform/auth/sso.service.js";
import type { SignInPolicy } from "./config/env.js";

/** No MFA, no single sign-on: what a Config without a sign-in policy (tests) means. */
const PASSWORD_ONLY: SignInPolicy = {
  mfaRequired: "off",
  totpIssuer: "Arcus Helpdesk",
  passwordSignIn: "all",
  breakGlassLogins: [],
};

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
  mfa: MfaService;
  /** Present when OIDC_ISSUER is set. */
  sso?: SsoService;
  signInAudit: SignInAudit;
  passwordReset: PasswordResetService;
  users: UsersService;
  notifications: NotificationsService;
  audit: AuditService;
  queries: QueriesService;
  inbox: InboxService;
  portal: PortalService;
  approvals: ApprovalsService;
  dashboard: DashboardService;
  incidents: IncidentsService;
  /** The arcus-incident-extras fields: next-action date, major flag. */
  ticketExtras: TicketExtras;
  problems: ProblemsService;
  /** Root-cause evidence and the AI draft on problems. */
  rca: RcaService;
  sla: SlaService;
  /** Coverage windows and holidays (Combodo's business-hours modules). */
  businessHours: BusinessHoursService;
  changes: ChangesService;
  /** Team dispatch: the team queue, "Take it", the assignment rules. */
  dispatch: DispatchService;
  /** Present when MAIL_INTAKE_SOURCE is set. */
  mailIntake?: MailIntakeService;
  requestForms: RequestFormsService;
  /** The admin import wizard (REST, previewed) and its kept reports. */
  dataImport: DataImportService;
  /** Recurring feeds: iTop's Data Synchro sources. */
  syncSources: SyncSourcesService;
  directory: DirectoryService;
  defaultOrganization: DefaultOrganization;
  currentContact: CurrentContact;
  tenancy: TenantResolver;
  tenantStore: TenantStore;
  /** A customer's own administration: organisations, teams, branding, email domains. */
  tenantAdmin: TenantAdminService;
  /** Joining by email domain (SELF_REGISTRATION=on). */
  registration: RegistrationService;
  /** Per-account settings iTop cannot keep: the interface language. */
  preferences: PreferencesStore;
}

export interface BuildServicesOptions {
  /** Injected in tests to avoid real HTTP and real schema files. */
  client?: ItopClient;
  schema?: CmdbSchema;
  navigation?: Navigation;
  dashboards?: Dashboards;
  sessions?: SessionStore;
  resetTokens?: ResetTokenStore;
  mfaStore?: MfaStore;
  signInAudit?: SignInAudit;
  /** Tenants for tests; otherwise from TENANTS_FILE or the BFF database. */
  tenants?: TenantStore;
  /** Preferences for tests; otherwise in the BFF database, or memory. */
  preferences?: PreferencesStore;
  /** Request forms for tests; otherwise in the BFF database, or memory. */
  requestForms?: RequestFormStore;
  /** Change plan rules for tests; otherwise in the BFF database, or memory. */
  planRules?: PlanRuleStore;
  /** Assignment rules for tests; otherwise in the BFF database, or memory. */
  assignmentRules?: AssignmentRuleStore;
  /** Import reports for tests; otherwise in the BFF database, or memory. */
  importReports?: ImportReportStore;
  /** Stands in for SMTP in tests; otherwise built from PASSWORD_RESET settings. */
  mailer?: Mailer;
  /** Stands in for the support mailbox in tests. */
  mailSource?: MailSource;
  /** Stands in for the Claude API in tests. */
  rcaModel?: RcaModel;
  logger?: Logger;
}

interface Stores {
  sessions: SessionStore;
  resetTokens: ResetTokenStore;
  mfaStore: MfaStore;
  signInAudit: SignInAudit;
  /** The MySQL pool, when SESSION_STORE=mysql: tenants share it. */
  pool?: Pool;
}

/**
 * Sessions, reset links, authenticator enrolments and the sign-in audit log:
 * in memory, or in MySQL when SESSION_STORE=mysql (one pool for all; the
 * session store closes it).
 */
function buildStores(config: Config, logger: Logger | undefined): Stores {
  const { sessionStore: store, sessionIdleMs, sessionMaxMs } = config.auth;
  if (store.kind === "memory") {
    return {
      sessions: new MemorySessionStore(sessionIdleMs, sessionMaxMs),
      resetTokens: new MemoryResetTokenStore(),
      mfaStore: new MemoryMfaStore(),
      signInAudit: new MemorySignInAudit(logger),
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
    mfaStore: new MySqlMfaStore(pool, new Sealer(store.secret, "mfa")),
    signInAudit: new MySqlSignInAudit(pool, logger),
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
  const policy = config.auth.signIn ?? PASSWORD_ONLY;
  const auth = new AuthService(client, Date.now, {
    policy,
    externalItopAuth: config.itop.externalAuthHeader !== undefined,
  });
  const stores =
    options.sessions && options.resetTokens && options.mfaStore && options.signInAudit
      ? undefined
      : buildStores(config, options.logger);
  const sessions = options.sessions ?? stores!.sessions;
  const resetTokens = options.resetTokens ?? stores!.resetTokens;
  const mfaStore = options.mfaStore ?? stores!.mfaStore;
  const signInAudit = options.signInAudit ?? stores!.signInAudit;
  const tenantStore = buildTenantStore(config, stores?.pool, options.tenants);
  const tenancy = new TenantResolver(tenantStore, config.tenancy ?? { enabled: false, platformLogins: [] });
  const reset = config.auth.passwordReset;
  const mailer = options.mailer ?? (reset ? new SmtpMailer(reset) : undefined);
  const dashboards =
    options.dashboards ?? Dashboards.fromFile(config.dashboardsPath, objects, schema);
  const transfer = new TransferService(client, schema);
  const businessHours = new BusinessHoursService(client);
  const changes = new ChangesService(
    client,
    options.planRules ?? (stores?.pool ? new MySqlPlanRuleStore(stores.pool) : new MemoryPlanRuleStore()),
    config.itop.timezone,
  );
  // Every action on a change, from any screen, meets the plan and CAB rules.
  objects.addTransitionGuard((className, id, stimulus, fields) =>
    changes.guardTransition(className, id, stimulus, fields),
  );
  const ticketExtras = new TicketExtras(client, config.itop.timezone);
  const relations = new RelationsService(client, schema);
  const rcaConfig = config.rca ?? { lookbackHours: 72 };
  const rcaModel =
    options.rcaModel ??
    (rcaConfig.ai ? new AnthropicRcaModel(rcaConfig.ai.apiKey, rcaConfig.ai.model, rcaConfig.ai.effort) : undefined);
  // The evidence asks the service whether to offer the AI button; the service needs the evidence.
  let rca: RcaService | undefined;
  const rcaEvidence = new RcaEvidenceService(objects, relations, client, schema, config.itop.timezone, () =>
    rca ? rca.aiEnabled() : false,
  );
  rca = new RcaService(rcaEvidence, objects, rcaConfig, rcaModel);
  const incidents = new IncidentsService(objects, schema, defaultOrganization, ticketExtras, mailer);
  const dispatch = new DispatchService(
    client,
    objects,
    options.assignmentRules ??
      (stores?.pool ? new MySqlAssignmentRuleStore(stores.pool) : new MemoryAssignmentRuleStore()),
    currentContact,
    config.appBaseUrl ?? "",
    mailer,
    options.logger,
  );
  // Every new ticket, from any screen, the portal or the mailbox, meets the
  // assignment rules; every dispatch can email the team.
  objects.addCreateListener((className, object) => dispatch.route(className, object));
  objects.addTransitionGuard((className, _id, stimulus) => dispatch.guard(className, stimulus));
  objects.addStimulusListener((className, object, stimulus) => dispatch.afterStimulus(className, object, stimulus));
  incidents.useDispatchCheck(() => dispatch.available());
  const mailIntake = config.mailIntake
    ? new MailIntakeService(
        config.mailIntake,
        options.mailSource ?? createMailSource(config.mailIntake),
        objects,
        incidents,
        defaultOrganization,
        mailer,
        config.notificationSender?.address ?? reset?.from,
        options.logger,
      )
    : undefined;
  // An email from an unknown sender lands in the organisation its domain belongs to.
  mailIntake?.useSenderDomains(async (email) => {
    if (!tenancy.enabled) return undefined;
    const hit = tenantOfEmail(email, await tenantStore.list());
    return hit ? String(hit.orgId) : undefined;
  });
  const passwordReset = new PasswordResetService(client, auth, resetTokens, sessions, mailer, reset);

  return {
    config,
    schema,
    navigation,
    dashboards,
    client,
    objects,
    attachments: new AttachmentsService(objects, schema),
    lookups: new LookupsService(client, schema, config.lookupCacheTtlMs),
    relations,
    history: new HistoryService(client, schema, config.itop.timezone),
    transfer,
    queries: new QueriesService(client, schema, objects, transfer),
    auth,
    sessions,
    mfa: new MfaService(mfaStore, policy),
    ...(policy.sso ? { sso: new SsoService(policy.sso, new Sealer(config.auth.secret, "sso-state")) } : {}),
    signInAudit,
    passwordReset,
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
    approvals: new ApprovalsService(client, config.itop.timezone),
    dashboard: new DashboardService(objects, navigation, currentContact, schema, ticketExtras),
    defaultOrganization,
    currentContact,
    incidents,
    ...(mailIntake ? { mailIntake } : {}),
    ticketExtras,
    problems: new ProblemsService(objects, client, config.itop.timezone),
    rca,
    sla: new SlaService(objects, config.itop.timezone, businessHours),
    businessHours,
    changes,
    dispatch,
    requestForms: new RequestFormsService(
      client,
      options.requestForms ?? (stores?.pool ? new MySqlRequestFormStore(stores.pool) : new MemoryRequestFormStore()),
    ),
    dataImport: new DataImportService(
      client,
      schema,
      options.importReports ?? (stores?.pool ? new MySqlImportReportStore(stores.pool) : new MemoryImportReportStore()),
      config.itop.timezone,
    ),
    syncSources: new SyncSourcesService(client, schema),
    directory: new DirectoryService(objects),
    tenancy,
    tenantStore,
    tenantAdmin: new TenantAdminService(client, tenantStore, tenancy),
    registration: new RegistrationService(client, tenancy, passwordReset, config.selfRegistration === true),
    preferences:
      options.preferences ?? (stores?.pool ? new MySqlPreferencesStore(stores.pool) : new MemoryPreferencesStore()),
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
