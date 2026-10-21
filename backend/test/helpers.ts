import type { Config } from "../src/config/env.js";
import { currentCaller } from "../src/core/request-context.js";
import { resultToAppError, type ItopClient } from "../src/itop/client.js";
import type { ItopResult, ItopVerb } from "../src/itop/types.js";
import { Navigation } from "../src/platform/navigation/navigation.service.js";
import { Dashboards } from "../src/platform/dashboards/dashboards.service.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import type { RawSchema } from "../src/schema/types.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    itop: {
      timezone: "Europe/Paris",
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
    server: { host: "127.0.0.1", port: 0, logLevel: "silent", trustProxy: false, ...overrides.server },
    corsOrigins: overrides.corsOrigins ?? "*",
    schemaPath: overrides.schemaPath ?? "unused-in-tests",
    navigationPath: overrides.navigationPath ?? "unused-in-tests",
    dashboardsPath: overrides.dashboardsPath ?? "unused-in-tests",
    lookupCacheTtlMs: overrides.lookupCacheTtlMs ?? 0,
    // Route tests exercise the API itself; auth has its own tests.
    auth: {
      required: false,
      sessionIdleMs: 3_600_000,
      sessionMaxMs: 12 * 3_600_000,
      cookieSecure: false,
      sessionStore: { kind: "memory" },
      ...overrides.auth,
    },
  };
}

export interface RecordedCall {
  verb: ItopVerb;
  params: Record<string, unknown>;
  /** Whose account the call ran under: the signed-in login, or "service". */
  as: string;
}

/**
 * Stand-in for ItopClient that records calls and replays canned results, so the
 * services and routes can be exercised without a running iTop.
 */
type Responder = (params: Record<string, unknown>) => ItopResult;

export class FakeItopClient {
  readonly calls: RecordedCall[] = [];
  private readonly responses: Partial<Record<ItopVerb, ItopResult | ItopResult[] | Responder>> = {};
  private readonly cursors = new Map<ItopVerb, number>();

  /** A fixed result, a queue of results, or a function of the call's params. */
  on(verb: ItopVerb, result: ItopResult | ItopResult[] | Responder): this {
    this.responses[verb] = result;
    return this;
  }

  private next(verb: ItopVerb, params: Record<string, unknown>): ItopResult {
    const configured = this.responses[verb];
    if (configured === undefined) {
      throw new Error(`FakeItopClient has no response configured for "${verb}"`);
    }
    if (typeof configured === "function") return configured(params);
    if (!Array.isArray(configured)) return configured;
    const index = this.cursors.get(verb) ?? 0;
    this.cursors.set(verb, index + 1);
    const result = configured[Math.min(index, configured.length - 1)];
    if (!result) throw new Error(`FakeItopClient ran out of responses for "${verb}"`);
    return result;
  }

  /** Logins whose password check succeeds, for verifyCredentials. */
  readonly passwords = new Map<string, string>();

  async callRaw<T extends ItopResult = ItopResult>(
    verb: ItopVerb,
    params: Record<string, unknown>,
    options: { asService?: boolean } = {},
  ): Promise<T> {
    const caller = options.asService ? undefined : currentCaller();
    this.calls.push({ verb, params, as: caller?.credentials?.user ?? "service" });
    return this.next(verb, params) as T;
  }

  async call<T extends ItopResult = ItopResult>(
    verb: ItopVerb,
    params: Record<string, unknown>,
    options: { asService?: boolean } = {},
  ): Promise<T> {
    const result = await this.callRaw<T>(verb, params, options);
    // Mapped exactly as the real client maps it.
    if (result.code !== 0) throw resultToAppError(verb, result);
    return result;
  }

  async checkCredentials(): Promise<boolean> {
    return true;
  }

  async verifyCredentials(user: string, password: string): Promise<boolean> {
    return this.passwords.get(user) === password;
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
            {
              id: "MyServers",
              kind: "list",
              class: "Server",
              label: "Assigned to me",
              rank: 40,
              oql: "SELECT Server WHERE agent_id = :current_contact_id",
              needsContact: true,
            },
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


/**
 * A dashboard over the sample schema, built from data so the tests do not
 * depend on the developer's extracted file. One of each dashlet kind that
 * carries data, plus a static one.
 */
export function sampleDashboards(
  client: ItopClient,
  schema: CmdbSchema = sampleSchema(),
): Dashboards {
  const objects = new ObjectsService(client, schema, "test");
  return Dashboards.fromData(
    {
      dashboards: {
        "Server:Overview": {
          id: "Server:Overview",
          title: "Server overview",
          columns: 2,
          dashlets: [
            { id: "1", kind: "badge", title: "Servers", class: "Server", oql: "SELECT Server" },
            { id: "2", kind: "pie", title: "By status", class: "Server", oql: "SELECT Server", groupBy: "status" },
            { id: "3", kind: "list", title: "Recent", class: "Server", oql: "SELECT Server" },
            { id: "4", kind: "text", title: "Note", text: "Static text" },
          ],
        },
      },
      skipped: [],
    },
    objects,
    schema,
  );
}
