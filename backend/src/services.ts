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
import { SessionStore } from "./platform/auth/session.store.js";
import { UsersService } from "./platform/admin/users.service.js";
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
  users: UsersService;
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
  logger?: Logger;
}

export function buildServices(config: Config, options: BuildServicesOptions = {}): Services {
  const schema = options.schema ?? CmdbSchema.fromFile(config.schemaPath);
  const navigation =
    options.navigation ?? Navigation.fromFile(config.navigationPath, schema);
  const client = options.client ?? new ItopClient(config, options.logger);
  const objects = new ObjectsService(client, schema, config.itop.defaultComment);
  const currentContact = new CurrentContact(client, config.itop.user);
  const defaultOrganization = new DefaultOrganization(
    objects,
    currentContact,
    config.defaultOrgId,
  );
  const auth = new AuthService(client);
  const sessions = new SessionStore(config.auth.sessionIdleMs, config.auth.sessionMaxMs);
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
    history: new HistoryService(client, schema),
    transfer: new TransferService(client, schema),
    auth,
    sessions,
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
