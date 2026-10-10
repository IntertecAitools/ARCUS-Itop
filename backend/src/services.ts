import type { Config } from "./config/env.js";
import { ItopClient, type Logger } from "./itop/client.js";
import { CmdbSchema } from "./schema/load.js";
import { DashboardService } from "./modules/dashboard/index.js";
import { DirectoryService } from "./modules/directory/index.js";
import { IncidentsService } from "./modules/incidents/index.js";
import { LookupsService } from "./platform/lookups/lookups.service.js";
import { Navigation } from "./platform/navigation/navigation.service.js";
import { ObjectsService } from "./platform/objects/objects.service.js";
import { RelationsService } from "./shared/relations.service.js";
import { DefaultOrganization } from "./shared/default-organization.js";

export interface Services {
  config: Config;
  schema: CmdbSchema;
  navigation: Navigation;
  client: ItopClient;
  objects: ObjectsService;
  lookups: LookupsService;
  relations: RelationsService;
  dashboard: DashboardService;
  incidents: IncidentsService;
  directory: DirectoryService;
  defaultOrganization: DefaultOrganization;
}

export interface BuildServicesOptions {
  /** Injected in tests to avoid real HTTP and real schema files. */
  client?: ItopClient;
  schema?: CmdbSchema;
  navigation?: Navigation;
  logger?: Logger;
}

export function buildServices(config: Config, options: BuildServicesOptions = {}): Services {
  const schema = options.schema ?? CmdbSchema.fromFile(config.schemaPath);
  const navigation =
    options.navigation ?? Navigation.fromFile(config.navigationPath, schema);
  const client = options.client ?? new ItopClient(config, options.logger);
  const objects = new ObjectsService(client, schema, config.itop.defaultComment);
  const defaultOrganization = new DefaultOrganization(
    objects,
    config.itop.user,
    config.defaultOrgId,
  );

  return {
    config,
    schema,
    navigation,
    client,
    objects,
    lookups: new LookupsService(client, schema, config.lookupCacheTtlMs),
    relations: new RelationsService(client, schema),
    dashboard: new DashboardService(objects),
    defaultOrganization,
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
