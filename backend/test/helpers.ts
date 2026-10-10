import type { Config } from "../src/config/env.js";
import type { ItopClient } from "../src/itop/client.js";
import type { ItopResult, ItopVerb } from "../src/itop/types.js";
import { Navigation } from "../src/platform/navigation/navigation.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import type { RawSchema } from "../src/schema/types.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    itop: {
      baseUrl: "http://itop.test",
      endpoint: "http://itop.test/webservices/rest.php",
      user: "svc",
      password: "secret",
      version: "1.4",
      timeoutMs: 5_000,
      retries: 0,
      defaultComment: "test",
      ...overrides.itop,
    },
    server: { host: "127.0.0.1", port: 0, logLevel: "silent", ...overrides.server },
    corsOrigins: overrides.corsOrigins ?? "*",
    schemaPath: overrides.schemaPath ?? "unused-in-tests",
    navigationPath: overrides.navigationPath ?? "unused-in-tests",
    lookupCacheTtlMs: overrides.lookupCacheTtlMs ?? 0,
  };
}

export interface RecordedCall {
  verb: ItopVerb;
  params: Record<string, unknown>;
}

/**
 * Stand-in for ItopClient that records calls and replays canned results, so the
 * services and routes can be exercised without a running iTop.
 */
export class FakeItopClient {
  readonly calls: RecordedCall[] = [];
  private readonly responses: Partial<Record<ItopVerb, ItopResult | ItopResult[]>> = {};
  private readonly cursors = new Map<ItopVerb, number>();

  on(verb: ItopVerb, result: ItopResult | ItopResult[]): this {
    this.responses[verb] = result;
    return this;
  }

  private next(verb: ItopVerb): ItopResult {
    const configured = this.responses[verb];
    if (configured === undefined) {
      throw new Error(`FakeItopClient has no response configured for "${verb}"`);
    }
    if (!Array.isArray(configured)) return configured;
    const index = this.cursors.get(verb) ?? 0;
    this.cursors.set(verb, index + 1);
    const result = configured[Math.min(index, configured.length - 1)];
    if (!result) throw new Error(`FakeItopClient ran out of responses for "${verb}"`);
    return result;
  }

  async callRaw<T extends ItopResult = ItopResult>(
    verb: ItopVerb,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ verb, params });
    return this.next(verb) as T;
  }

  async call<T extends ItopResult = ItopResult>(
    verb: ItopVerb,
    params: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.callRaw<T>(verb, params);
    if (result.code !== 0) {
      throw new Error(`FakeItopClient: verb ${verb} returned code ${result.code}`);
    }
    return result;
  }

  async checkCredentials(): Promise<boolean> {
    return true;
  }

  async listOperations(): Promise<{ verb: string; description: string }[]> {
    return [{ verb: "core/get", description: "Search for objects" }];
  }

  /** The services only use the methods above, so the cast is safe. */
  asClient(): ItopClient {
    return this as unknown as ItopClient;
  }

  lastCall(): RecordedCall {
    const last = this.calls[this.calls.length - 1];
    if (!last) throw new Error("FakeItopClient recorded no calls");
    return last;
  }
}

/** Builds an iTop core/get style response from plain objects. */
export function getResponse(
  rows: { class: string; id: number; fields: Record<string, unknown> }[],
  total = rows.length,
): ItopResult {
  const objects: Record<string, { code: number; message: string; class: string; key: string; fields: Record<string, unknown> }> =
    {};
  for (const row of rows) {
    objects[`${row.class}::${row.id}`] = {
      code: 0,
      message: "",
      class: row.class,
      key: String(row.id),
      fields: row.fields,
    };
  }
  return { code: 0, message: `Found: ${total}`, objects };
}

/**
 * A compact schema covering every shape the BFF has to handle: a required
 * scalar, an enum, an external key with a dependent filter, a computed
 * ExternalField, a link set, a HierarchicalKey and a Dashboard.
 */
export const SAMPLE_RAW_SCHEMA: RawSchema = {
  Organization: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["name", "status", "parent_id", "overview"],
    readonly: ["parent_name"],
    fields: {
      name: { type: "String", ui: "scalar", owner: "Organization", required: true },
      status: {
        type: "Enum",
        ui: "scalar",
        owner: "Organization",
        values: ["active", "inactive"],
      },
      // Mis-tagged by extract-schema.py: really a foreign key to Organization.
      parent_id: { type: "HierarchicalKey", ui: "scalar", owner: "Organization" },
      parent_name: {
        type: "ExternalField",
        ui: "readonly",
        owner: "Organization",
        via_key: "parent_id",
        via_att: "name",
      },
      // Mis-tagged by extract-schema.py: a rendered view, not stored data.
      overview: { type: "Dashboard", ui: "scalar", owner: "Organization" },
    },
  },
  Brand: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["name"],
    readonly: [],
    fields: { name: { type: "String", ui: "scalar", owner: "Brand", required: true } },
  },
  Model: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject"],
    lifecycle: null,
    writable: ["name", "brand_id"],
    readonly: [],
    fields: {
      name: { type: "String", ui: "scalar", owner: "Model", required: true },
      brand_id: { type: "ExternalKey", ui: "picker", owner: "Model", target: "Brand" },
    },
  },
  Server: {
    is_ci: true,
    abstract: false,
    inherits: ["cmdbAbstractObject", "FunctionalCI", "PhysicalDevice"],
    lifecycle: null,
    writable: ["name", "status", "org_id", "brand_id", "model_id", "nb_u", "purchase_date"],
    readonly: ["brand_name", "model_name"],
    fields: {
      name: { type: "String", ui: "scalar", owner: "FunctionalCI", required: true },
      description: { type: "Text", ui: "scalar", owner: "FunctionalCI" },
      status: {
        type: "Enum",
        ui: "scalar",
        owner: "PhysicalDevice",
        values: ["production", "implementation", "stock", "obsolete"],
      },
      nb_u: { type: "Integer", ui: "scalar", owner: "Server" },
      purchase_date: { type: "Date", ui: "scalar", owner: "PhysicalDevice" },
      org_id: {
        type: "ExternalKey",
        ui: "picker",
        owner: "FunctionalCI",
        target: "Organization",
        required: true,
      },
      brand_id: { type: "ExternalKey", ui: "picker", owner: "PhysicalDevice", target: "Brand" },
      brand_name: {
        type: "ExternalField",
        ui: "readonly",
        owner: "PhysicalDevice",
        via_key: "brand_id",
        via_att: "name",
      },
      model_id: {
        type: "ExternalKey",
        ui: "picker",
        owner: "PhysicalDevice",
        target: "Model",
        filter: "SELECT Model WHERE brand_id=:this->brand_id",
        depends_on: ["brand_id"],
      },
      model_name: {
        type: "ExternalField",
        ui: "readonly",
        owner: "PhysicalDevice",
        via_key: "model_id",
        via_att: "name",
      },
      // Picker whose target is absent from this schema, like the real
      // Organization.deliverymodel_id -> DeliveryModel.
      deliverymodel_id: {
        type: "ExternalKey",
        ui: "picker",
        owner: "Server",
        target: "DeliveryModel",
      },
      // A filter the translator must refuse rather than mistranslate.
      location_id: {
        type: "ExternalKey",
        ui: "picker",
        owner: "PhysicalDevice",
        target: "Organization",
        filter:
          "SELECT l FROM Location AS l JOIN Organization AS root ON l.org_id=root.id WHERE root.id= :this->org_id",
        depends_on: ["org_id"],
      },
      softwares_list: {
        type: "LinkedSet",
        ui: "related",
        owner: "FunctionalCI",
        linked: "SoftwareInstance",
        link_key: "system_id",
      },
    },
  },
};

export function sampleSchema(): CmdbSchema {
  return CmdbSchema.fromRaw(SAMPLE_RAW_SCHEMA);
}

/**
 * A navigation tree over the sample schema.
 *
 * Built from data rather than read from cmdb-navigation.json so the tests stay
 * independent of whatever modules happen to be installed in the developer's
 * iTop. It deliberately includes one entry whose class is absent from the
 * sample schema, because dropping unknown classes with a diagnostic is
 * behaviour worth covering.
 */
export function sampleNavigation(schema: CmdbSchema = sampleSchema()): Navigation {
  return Navigation.fromData(
    {
      groups: [
        {
          id: "ConfigManagement",
          label: "Configuration management",
          rank: 20,
          isAdmin: false,
          entries: [
            {
              id: "Servers",
              kind: "list",
              class: "Server",
              label: "Servers",
              rank: 10,
              oql: "SELECT Server WHERE status = 'production'",
            },
            { id: "NewServer", kind: "create", class: "Server", label: "New server", rank: 20 },
            { id: "SearchServers", kind: "search", class: "Server", label: "Search", rank: 30 },
          ],
        },
        {
          id: "DataAdministration",
          label: "Data administration",
          rank: 70,
          isAdmin: false,
          entries: [
            { id: "Organization", kind: "list", class: "Organization", label: "Organizations", rank: 10 },
            { id: "Ghosts", kind: "list", class: "NotInSchema", label: "Ghosts", rank: 20 },
          ],
        },
        {
          id: "AdminTools",
          label: "Administration",
          rank: 80,
          isAdmin: true,
          entries: [
            { id: "Brands", kind: "list", class: "Brand", label: "Brands", rank: 10 },
          ],
        },
      ],
      classLabels: { Server: "Server", Organization: "Organization", Brand: "Brand" },
      excluded: [
        { id: "WelcomeMenuPage", type: "DashboardMenuNode", reason: "itop-dashboard: not replicated" },
      ],
    },
    schema,
  );
}
