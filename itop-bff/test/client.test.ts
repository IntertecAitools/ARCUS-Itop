import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";

import { AppError } from "../src/errors.js";
import { ItopClient } from "../src/itop/client.js";
import { testConfig } from "./helpers.js";

interface Captured {
  method: string;
  contentType: string | undefined;
  body: string;
}

/**
 * Spins up a throwaway HTTP server standing in for rest.php, so the transport
 * is tested for real: form encoding, timeouts, retries, and the fact that iTop
 * signals application errors with HTTP 200.
 */
async function withServer(
  handler: (captured: Captured) => { status?: number; body: string; contentType?: string },
  run: (client: ItopClient, captured: Captured[]) => Promise<void>,
  configOverrides: Partial<ReturnType<typeof testConfig>["itop"]> = {},
): Promise<void> {
  const captured: Captured[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const record: Captured = {
        method: request.method ?? "",
        contentType: request.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      };
      captured.push(record);
      const result = handler(record);
      response.writeHead(result.status ?? 200, {
        "Content-Type": result.contentType ?? "application/json",
      });
      response.end(result.body);
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port assigned");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const config = testConfig();
  config.itop = {
    ...config.itop,
    baseUrl,
    endpoint: `${baseUrl}/webservices/rest.php`,
    ...configOverrides,
  };

  try {
    await run(new ItopClient(config), captured);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers) server.close();
  servers.length = 0;
});

describe("ItopClient transport", () => {
  it("posts form-encoded parameters with the operation inside json_data", async () => {
    await withServer(
      () => ({ body: JSON.stringify({ code: 0, message: "Found: 0", objects: null }) }),
      async (client, captured) => {
        await client.call("core/get", { class: "Server", key: 1 });

        const request = captured[0]!;
        assert.equal(request.method, "POST");
        assert.match(String(request.contentType), /application\/x-www-form-urlencoded/);

        const params = new URLSearchParams(request.body);
        // rest.php reads version via utils::ReadParam, but the verb via json_data.
        assert.equal(params.get("version"), "1.4");
        assert.equal(params.get("auth_user"), "svc");
        assert.equal(params.get("auth_pwd"), "secret");

        const jsonData = JSON.parse(params.get("json_data") ?? "{}");
        assert.equal(jsonData.operation, "core/get");
        assert.equal(jsonData.class, "Server");
        assert.equal(jsonData.key, 1);
      },
    );
  });

  it("turns an HTTP 200 application error into a real HTTP status", async () => {
    // This is the crux: rest.php answers 200 even for failures.
    await withServer(
      () => ({ status: 200, body: JSON.stringify({ code: 1, message: "Error: Invalid login" }) }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) =>
            error instanceof AppError &&
            error.status === 403 &&
            error.itopCode === 1 &&
            /REST Services User/.test(error.message),
        );
      },
    );
  });

  it("maps a missing object onto 404", async () => {
    await withServer(
      () => ({
        body: JSON.stringify({ code: 100, message: "Error: Invalid object Server::9999" }),
      }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) => error instanceof AppError && error.status === 404,
        );
      },
    );
  });

  it("maps an ambiguous key onto 409", async () => {
    await withServer(
      () => ({
        body: JSON.stringify({
          code: 100,
          message: "Error: Several items found (3) with criteria: name: srv",
        }),
      }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) => error instanceof AppError && error.status === 409,
        );
      },
    );
  });

  it("maps a genuine internal error onto 502", async () => {
    await withServer(
      () => ({ body: JSON.stringify({ code: 100, message: "Error: something broke" }) }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) => error instanceof AppError && error.status === 502,
        );
      },
    );
  });

  it("explains a non-JSON response instead of throwing a parse error", async () => {
    // A PHP fatal or an HTML login page is the usual cause.
    await withServer(
      () => ({ body: "<html><body>PHP Fatal error</body></html>", contentType: "text/html" }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) =>
            error instanceof AppError && /non-JSON/.test(error.message) && error.status === 502,
        );
      },
    );
  });

  it("reports a non-2xx status as an upstream problem", async () => {
    await withServer(
      () => ({ status: 404, body: "Not Found", contentType: "text/plain" }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) => error instanceof AppError && /HTTP 404/.test(error.message),
        );
      },
    );
  });

  it("rejects a JSON body with no code field", async () => {
    await withServer(
      () => ({ body: JSON.stringify({ unexpected: true }) }),
      async (client) => {
        await assert.rejects(
          () => client.call("core/get", {}),
          (error: unknown) => error instanceof AppError && /"code"/.test(error.message),
        );
      },
    );
  });

  it("retries an idempotent verb after a transport failure", async () => {
    let attempts = 0;
    await withServer(
      () => {
        attempts += 1;
        // A 503 is classified as upstream_unavailable, which is retriable.
        if (attempts === 1) return { status: 503, body: "busy", contentType: "text/plain" };
        return { body: JSON.stringify({ code: 0, message: "Found: 0", objects: null }) };
      },
      async (client, captured) => {
        const result = await client.call("core/get", {});
        assert.equal(result.code, 0);
        assert.equal(captured.length, 2, "retried once");
      },
      { retries: 2 },
    );
  });

  it("never retries a write, which could duplicate an object", async () => {
    let attempts = 0;
    await withServer(
      () => {
        attempts += 1;
        return { status: 503, body: "busy", contentType: "text/plain" };
      },
      async (client, captured) => {
        await assert.rejects(() => client.call("core/create", {}), AppError);
        assert.equal(captured.length, 1, "core/create must be attempted exactly once");
        assert.equal(attempts, 1);
      },
      { retries: 3 },
    );
  });

  it("times out rather than hanging", async () => {
    const server = createServer(() => {
      /* deliberately never responds */
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");

    const config = testConfig();
    config.itop = {
      ...config.itop,
      endpoint: `http://127.0.0.1:${address.port}/webservices/rest.php`,
      timeoutMs: 1_000,
      retries: 0,
    };

    await assert.rejects(
      () => new ItopClient(config).call("core/get", {}),
      (error: unknown) =>
        error instanceof AppError && error.status === 504 && /within 1000ms/.test(error.message),
    );
  });

  it("reports an unreachable host clearly", async () => {
    const config = testConfig();
    // Port 1 on loopback refuses connections immediately.
    config.itop = {
      ...config.itop,
      endpoint: "http://127.0.0.1:1/webservices/rest.php",
      retries: 0,
    };

    await assert.rejects(
      () => new ItopClient(config).call("core/get", {}),
      (error: unknown) => error instanceof AppError && /Cannot reach iTop/.test(error.message),
    );
  });

  it("callRaw surfaces a non-zero code instead of throwing", async () => {
    await withServer(
      () => ({ body: JSON.stringify({ code: 12, message: "unsafe", objects: null }) }),
      async (client) => {
        const result = await client.callRaw("core/delete", {});
        assert.equal(result.code, 12);
      },
    );
  });

  it("reads the authorized flag from check_credentials", async () => {
    await withServer(
      () => ({ body: JSON.stringify({ code: 0, message: null, authorized: true }) }),
      async (client) => {
        assert.equal(await client.checkCredentials(), true);
      },
    );
  });
});
