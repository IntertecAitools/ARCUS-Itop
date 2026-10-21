import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { trustProxy } from "../src/config/env.js";
import { FakeItopClient, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

describe("TRUST_PROXY", () => {
  it("reads true/false, a hop count, or a list of proxy addresses", () => {
    assert.equal(trustProxy("false"), false);
    assert.equal(trustProxy(""), false);
    assert.equal(trustProxy("TRUE"), true);
    assert.equal(trustProxy("2"), 2);
    assert.deepEqual(trustProxy("10.0.0.0/8, 127.0.0.1"), ["10.0.0.0/8", "127.0.0.1"]);
    assert.throws(() => trustProxy("0"), /hop count/);
    assert.throws(() => trustProxy("yes please"), /TRUST_PROXY/);
  });

  it("with a hop count, a client cannot choose the address its sign-ins count against", async () => {
    const fake = new FakeItopClient();
    const schema = sampleSchema();
    const { app } = buildApp(
      testConfig({
        server: { host: "127.0.0.1", port: 0, logLevel: "silent", trustProxy: 2 },
        auth: { ...testConfig().auth, required: true },
      }),
      { client: fake.asClient(), schema, navigation: sampleNavigation(schema), dashboards: sampleDashboards(fake.asClient(), schema) },
    );
    after(() => app.close());
    // TLS proxy appended 203.0.113.9 (the real client) to whatever the client
    // sent; nginx (the socket) appended the TLS proxy. The client's own
    // forged entry changes every time and must not matter.
    const attempt = (forged: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "172.18.0.3",
        headers: { "x-forwarded-for": `${forged}, 203.0.113.9, 172.18.0.2` },
        payload: { login: `user-${forged}`, password: "wrong" },
      });
    for (let i = 1; i <= 10; i += 1) assert.equal((await attempt(`198.51.100.${i}`)).statusCode, 401);
    assert.equal((await attempt("198.51.100.200")).statusCode, 429);
  });
});
