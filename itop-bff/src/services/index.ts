import type { Config } from "../config.js";
import { ItopClient, type Logger } from "../itop/client.js";
import { CmdbSchema } from "../schema/load.js";
import { LookupsService } from "./lookups.js";
import { ObjectsService } from "./objects.js";
import { RelationsService } from "./relations.js";

export interface Services {
  config: Config;
  schema: CmdbSchema;
  client: ItopClient;
  objects: ObjectsService;
  lookups: LookupsService;
  relations: RelationsService;
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

  return {
    config,
    schema,
    client,
    objects: new ObjectsService(client, schema, config.itop.defaultComment),
    lookups: new LookupsService(client, schema, config.lookupCacheTtlMs),
    relations: new RelationsService(client, schema),
  };
}

export { ObjectsService, LookupsService, RelationsService };
