import type { Config } from "./config/env.js";
import { ItopClient, type Logger } from "./itop/client.js";
import { CmdbSchema } from "./schema/load.js";
import { DashboardService } from "./modules/dashboard/dashboard.service.js";
import { LookupsService } from "./platform/lookups/lookups.service.js";
import { ObjectsService } from "./platform/objects/objects.service.js";
import { RelationsService } from "./shared/relations.service.js";

export interface Services {
  config: Config;
  schema: CmdbSchema;
  client: ItopClient;
  objects: ObjectsService;
  lookups: LookupsService;
  relations: RelationsService;
  dashboard: DashboardService;
}

export interface BuildServicesOptions {
  /** Injected in tests to avoid real HTTP and real schema files. */
  client?: ItopClient;
  schema?: CmdbSchema;
  logger?: Logger;
}

export function buildServices(config: Config, options: BuildServicesOptions = {}): Services {
  const schema = options.schema ?? CmdbSchema.fromFile(config.schemaPath);
  const client = options.client ?? new ItopClient(config, options.logger);
  const objects = new ObjectsService(client, schema, config.itop.defaultComment);

  return {
    config,
    schema,
    client,
    objects,
    lookups: new LookupsService(client, schema, config.lookupCacheTtlMs),
    relations: new RelationsService(client, schema),
    dashboard: new DashboardService(objects),
  };
}

export { ObjectsService, LookupsService, RelationsService, DashboardService };
