/**
 * Fails fast when the stack these tests need is not running.
 *
 * Without this, a missing backend shows up as every test timing out one by one
 * with an unrelated-looking error. One clear message up front is cheaper than
 * reading a dozen stack traces.
 */
const BFF = process.env.VITE_BFF_URL ?? 'http://localhost:4000/api';
const origin = new URL(BFF).origin;

async function probe(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function globalSetup() {
  const health = await probe(`${origin}/health`, 5_000);
  if (!health) {
    throw new Error(
      `The backend is not responding at ${origin}.\n\n` +
        `These tests run against the real stack — no mocks — so it must be up:\n` +
        `  1. cd docker && docker compose up -d     # iTop on :8080\n` +
        `  2. cd backend && npm run dev             # BFF on :4000\n`,
    );
  }

  // Liveness is not enough: the BFF answers /health without iTop, and every
  // test would then fail on a 502 that looks like a frontend bug.
  const upstream = await probe(`${origin}/health/upstream`, 60_000);
  if (!upstream || upstream.status !== 'ok') {
    throw new Error(
      `The backend is up but cannot reach iTop (${upstream?.error ?? 'no response'}).\n\n` +
        `Check iTop is running on :8080 and that ITOP_USER / ITOP_PASSWORD in\n` +
        `backend/.env are correct. Verify with:\n` +
        `  curl ${origin}/health/upstream\n`,
    );
  }
}
