/**
 * Live smoke test against a running iTop.
 *
 * Read-only by default: it reaches the real backend and proves the contract
 * holds end to end, without creating or modifying anything. Pass --write to
 * additionally create, update, simulate-delete and delete one throwaway
 * Organization.
 *
 *   npm run smoke
 *   npm run smoke -- --write
 *
 * Requires a reachable iTop and a .env with working credentials.
 */

import { loadConfig } from "../src/config/env.js";
import { AppError } from "../src/core/errors.js";
import { buildServices } from "../src/services.js";

const WRITE = process.argv.includes("--write");

let passed = 0;
let failed = 0;

async function step(name: string, run: () => Promise<string | void>): Promise<void> {
  const startedAt = Date.now();
  try {
    const detail = await run();
    passed += 1;
    const ms = Date.now() - startedAt;
    console.log(`  PASS  ${name}${detail ? ` -- ${detail}` : ""} (${ms}ms)`);
  } catch (error) {
    failed += 1;
    const message =
      error instanceof AppError
        ? `${error.code}${error.itopCode !== undefined ? ` / iTop ${error.itopCode}` : ""}: ${error.message}`
        : (error as Error).message;
    console.log(`  FAIL  ${name}\n          ${message}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const services = buildServices(config);
  const { client, schema, objects, lookups, relations } = services;

  console.log(`iTop      : ${config.itop.baseUrl}`);
  console.log(`REST      : v${config.itop.version} as "${config.itop.user}"`);
  console.log(`Schema    : ${schema.classNames.length} classes, ${schema.diagnostics.length} corrections`);
  console.log(`Mode      : ${WRITE ? "READ + WRITE" : "read-only"}\n`);

  await step("credentials accepted", async () => {
    const ok = await client.checkCredentials();
    if (!ok) {
      throw new Error(
        'iTop returned authorized=false. Check the account holds the "REST Services User" profile.',
      );
    }
    return "authorized";
  });

  await step("list_operations reports the core verbs", async () => {
    const operations = await client.listOperations();
    const verbs = operations.map((o) => o.verb);
    for (const required of ["core/get", "core/create", "core/update", "core/delete"]) {
      if (!verbs.includes(required)) throw new Error(`missing verb ${required}`);
    }
    return `${verbs.length} verbs`;
  });

  await step("list Organizations", async () => {
    const result = await objects.list("Organization", { page: 1, limit: 5 });
    return `${result.items.length} of ${result.total}`;
  });

  let probeId: number | undefined;
  await step("fetch one Organization in full", async () => {
    const list = await objects.list("Organization", { page: 1, limit: 1 });
    const first = list.items[0];
    if (!first) return "no Organizations exist, skipped";
    probeId = first.id;
    const full = await objects.get("Organization", first.id, "full");
    return `${full.label} with ${Object.keys(full.fields).length} fields`;
  });

  await step("read-only fields are returned but marked read-only", async () => {
    const info = schema.require("Organization");
    if (!info.readonlyFields.includes("parent_name")) {
      throw new Error("expected parent_name to be read-only");
    }
    return `${info.readonlyFields.length} read-only, ${info.writable.length} writable`;
  });

  await step("text search builds valid OQL", async () => {
    const result = await objects.list("Organization", { page: 1, limit: 5, q: "a" });
    return `${result.total} matches`;
  });

  await step("a quote in a search term does not break the query", async () => {
    // Proves the OQL escaper holds against the real parser.
    const result = await objects.list("Organization", { page: 1, limit: 5, q: "O'Brien" });
    return `${result.total} matches, no parse error`;
  });

  await step("picker options load", async () => {
    const result = await lookups.forClass("Organization", { limit: 5 });
    return `${result.options.length} options of ${result.total}`;
  });

  await step("Server CI listing", async () => {
    const result = await objects.list("Server", { page: 1, limit: 5 });
    return `${result.total} servers`;
  });

  await step("BFF-side sort works", async () => {
    const result = await objects.list("Organization", {
      page: 1,
      limit: 5,
      sort: "name",
      order: "asc",
    });
    if (!result.sortedInBff) throw new Error("expected sortedInBff=true");
    return `${result.items.length} rows sorted`;
  });

  if (probeId !== undefined) {
    await step("impact graph loads", async () => {
      const graph = await relations.graph("Organization", probeId!, { relation: "impacts" });
      return `${graph.nodes.length} nodes, ${graph.edges.length} edges`;
    });
  }

  await step("unknown class is a clean 404", async () => {
    try {
      await objects.get("DefinitelyNotAClass", 1);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return "404 as expected";
      throw error;
    }
    throw new Error("expected a 404");
  });

  await step("writing a computed field is refused before it reaches iTop", async () => {
    try {
      await objects.update("Organization", probeId ?? 1, { parent_name: "nope" });
    } catch (error) {
      if (error instanceof AppError && error.status === 400) return "rejected locally";
      throw error;
    }
    throw new Error("expected a 400");
  });

  if (WRITE) {
    console.log("\n  --- write cycle on a throwaway Organization ---");
    const name = `zz-bff-smoke-${Date.now()}`;
    let createdId: number | undefined;

    await step(`create ${name}`, async () => {
      const { object } = await objects.create(
        "Organization",
        { name, status: "active" },
        { comment: "itop-bff smoke test" },
      );
      createdId = object.id;
      return `id ${object.id}`;
    });

    if (createdId !== undefined) {
      await step("update it", async () => {
        const { object } = await objects.update(
          "Organization",
          createdId!,
          { status: "inactive" },
          { comment: "itop-bff smoke test" },
        );
        if (object.fields["status"] !== "inactive") {
          throw new Error(`status is ${String(object.fields["status"])}`);
        }
        return "status -> inactive";
      });

      await step("simulate deleting it", async () => {
        const result = await objects.remove("Organization", createdId!, { simulate: true });
        return `${result.plan.length} planned change(s)`;
      });

      await step("delete it", async () => {
        const result = await objects.remove("Organization", createdId!, {
          comment: "itop-bff smoke test cleanup",
        });
        return result.message;
      });

      await step("confirm it is gone", async () => {
        try {
          await objects.get("Organization", createdId!);
        } catch (error) {
          if (error instanceof AppError && error.status === 404) return "404 as expected";
          throw error;
        }
        throw new Error("object still exists");
      });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (!WRITE) console.log("Re-run with --write to exercise create/update/delete.");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`\nsmoke test could not start: ${(error as Error).message}`);
  process.exit(1);
});
