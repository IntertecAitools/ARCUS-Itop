#!/usr/bin/env node
/**
 * Vendors a snapshot of the compiled CMDB schema into this package.
 *
 * Normally the BFF reads the schema in place via CMDB_SCHEMA_PATH, which keeps
 * it fresh during development. Run this before packaging or deploying, when the
 * sibling cmdb-schema directory will not travel with the build.
 *
 *   node scripts/pull-schema.mjs [source] [destination]
 */

import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, process.argv[2] ?? "../cmdb-schema/cmdb-schema.json");
const destination = resolve(packageRoot, process.argv[3] ?? "schema/cmdb-schema.json");

try {
  statSync(source);
} catch {
  console.error(
    `Schema not found at ${source}\n` +
      `Generate it first:  python cmdb-schema/extract-schema.py`,
  );
  process.exit(1);
}

let classCount;
try {
  const parsed = JSON.parse(readFileSync(source, "utf8"));
  classCount = Object.keys(parsed).length;
  if (classCount === 0) throw new Error("no classes");
} catch (error) {
  console.error(`${source} is not a usable schema: ${error.message}`);
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

console.log(`Copied ${classCount} classes`);
console.log(`  from ${source}`);
console.log(`  to   ${destination}`);
console.log(`\nSet CMDB_SCHEMA_PATH=${"schema/cmdb-schema.json"} to use the vendored copy.`);
