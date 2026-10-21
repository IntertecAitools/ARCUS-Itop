import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RateLimiter } from "../src/core/rate-limiter.js";

describe("RateLimiter", () => {
  it("lets attempts through again once the window has passed", () => {
    const clock = { t: 0 };
    const limiter = new RateLimiter(2, 1000, () => clock.t);
    assert.equal(limiter.allow("k"), true);
    assert.equal(limiter.allow("k"), true);
    assert.equal(limiter.allow("k"), false);
    clock.t = 1001;
    assert.equal(limiter.allow("k"), true);
  });

  it("counts only what is recorded, and forgets a cleared key", () => {
    const clock = { t: 0 };
    const limiter = new RateLimiter(2, 1000, () => clock.t);
    assert.equal(limiter.blocked("k"), false);
    limiter.record("k");
    clock.t = 100;
    limiter.record("k");
    assert.equal(limiter.blocked("k"), true);
    assert.equal(limiter.blocked("other"), false);
    // Free again when the first event leaves the window.
    assert.equal(limiter.retryAfterMs("k"), 900);
    limiter.clear("k");
    assert.equal(limiter.blocked("k"), false);
    assert.equal(limiter.retryAfterMs("k"), 0);
  });
});
