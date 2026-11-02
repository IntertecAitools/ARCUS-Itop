import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { rcaConfig } from "../src/config/env.js";

const KEYS = [
  "RCA_AI",
  "RCA_AI_PROVIDER",
  "RCA_AI_MODEL",
  "ANTHROPIC_API_KEY",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "BEDROCK_MODEL_ID",
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("rcaConfig — AI provider", () => {
  it("uses the Claude API with ANTHROPIC_API_KEY by default", () => {
    setEnv({ ANTHROPIC_API_KEY: "k" });
    const ai = rcaConfig().ai;
    assert.equal(ai?.provider, "anthropic");
    assert.equal(ai?.model, "claude-opus-5-5");
  });

  it("is off without credentials for the chosen provider", () => {
    setEnv({});
    assert.equal(rcaConfig().ai, undefined);
    setEnv({ RCA_AI_PROVIDER: "bedrock", AWS_REGION: "us-east-1" });
    assert.equal(rcaConfig().ai, undefined);
  });

  it("uses Bedrock with a Bedrock API key, AWS_REGION and BEDROCK_MODEL_ID", () => {
    setEnv({
      RCA_AI_PROVIDER: "bedrock",
      AWS_REGION: "us-east-1",
      AWS_BEARER_TOKEN_BEDROCK: "token",
      BEDROCK_MODEL_ID: "anthropic.claude-sonnet-5",
    });
    const ai = rcaConfig().ai;
    assert.equal(ai?.provider, "bedrock");
    assert.equal(ai?.region, "us-east-1");
    assert.equal(ai?.model, "anthropic.claude-sonnet-5");
    assert.equal(ai?.apiKey, "");
  });

  it("ignores ANTHROPIC_API_KEY on Bedrock, and needs a region", () => {
    setEnv({ RCA_AI_PROVIDER: "bedrock", ANTHROPIC_API_KEY: "k", AWS_ACCESS_KEY_ID: "id" });
    assert.throws(() => rcaConfig(), /AWS_REGION/);
  });

  it("refuses an unknown provider", () => {
    setEnv({ RCA_AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "k" });
    assert.throws(() => rcaConfig(), /RCA_AI_PROVIDER/);
  });
});
