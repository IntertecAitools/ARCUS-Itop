import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Relative paths in .env resolve against the package root (the directory
 * holding package.json), which is two levels up from `src/config/`.
 */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Minimal .env loader. Deliberately dependency-free: the only consumer is this
 * file, and dotenv's extra features (expansion, multiline) are not used here.
 * Real environment variables always win over the file.
 */
function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // absent .env is fine -- the environment may supply everything
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key === "" || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}".`);
  }
  return parsed;
}

/** REST dialects this iTop build accepts (CoreServices::ListOperations). */
export const SUPPORTED_REST_VERSIONS = ["1.0", "1.1", "1.2", "1.3", "1.4"] as const;

export interface Config {
  itop: {
    /** Fully-qualified rest.php endpoint. */
    endpoint: string;
    baseUrl: string;
    user: string;
    password: string;
    version: string;
    timeoutMs: number;
    retries: number;
    defaultComment: string;
  };
  server: { host: string; port: number; logLevel: string };
  corsOrigins: string[] | "*";
  schemaPath: string;
  /** iTop's navigation tree, from cmdb-schema/extract-navigation.py. */
  navigationPath: string;
  lookupCacheTtlMs: number;
  /** Pins the organisation new records belong to. Optional. */
  defaultOrgId?: string;
}

export function loadConfig(envFile = resolve(PACKAGE_ROOT, ".env")): Config {
  loadDotEnv(envFile);

  const baseUrl = optional("ITOP_BASE_URL", "http://localhost:8080").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`ITOP_BASE_URL must start with http:// or https://, got "${baseUrl}".`);
  }

  const version = optional("ITOP_REST_VERSION", "1.4");
  if (!(SUPPORTED_REST_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(
      `ITOP_REST_VERSION "${version}" is not supported by iTop 3.4. ` +
        `Use one of: ${SUPPORTED_REST_VERSIONS.join(", ")}.`,
    );
  }

  const corsRaw = optional("CORS_ORIGINS", "*");
  const corsOrigins: string[] | "*" =
    corsRaw === "*"
      ? "*"
      : corsRaw
          .split(",")
          .map((o) => o.trim().replace(/\/+$/, ""))
          .filter((o) => o !== "");

  return {
    itop: {
      baseUrl,
      endpoint: `${baseUrl}/webservices/rest.php`,
      user: required("ITOP_USER"),
      password: required("ITOP_PASSWORD"),
      version,
      timeoutMs: integer("ITOP_TIMEOUT_MS", 30_000, 1_000, 600_000),
      retries: integer("ITOP_RETRIES", 2, 0, 10),
      // Lands in iTop's change log on every write, so it is read by humans
      // auditing history inside iTop itself.
      defaultComment: optional("ITOP_DEFAULT_COMMENT", "via intertec-backend"),
    },
    server: {
      host: optional("HOST", "127.0.0.1"),
      // 0 is allowed and means "let the OS pick a free port", which containers
      // and test harnesses rely on.
      port: integer("PORT", 4000, 0, 65_535),
      logLevel: optional("LOG_LEVEL", "info"),
    },
    corsOrigins,
    schemaPath: resolve(
      PACKAGE_ROOT,
      optional("CMDB_SCHEMA_PATH", "../cmdb-schema/cmdb-schema.json"),
    ),
    navigationPath: resolve(
      PACKAGE_ROOT,
      optional("CMDB_NAVIGATION_PATH", "../cmdb-schema/cmdb-navigation.json"),
    ),
    lookupCacheTtlMs: integer("LOOKUP_CACHE_TTL", 60, 0, 86_400) * 1000,
    ...(optional("ITOP_DEFAULT_ORG_ID", "") ? { defaultOrgId: optional("ITOP_DEFAULT_ORG_ID", "") } : {}),
  };
}
