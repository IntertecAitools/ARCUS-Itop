import { NextResponse } from "next/server";

// Credentials are read here, on the server, and nowhere else.
// They must never carry a NEXT_PUBLIC_ prefix — that would inline them into the
// browser bundle, which is exactly the failure this route exists to prevent.
const ITOP_URL = process.env.ITOP_REST_URL;
const ITOP_USER = process.env.ITOP_REST_USER;
const ITOP_PASSWORD = process.env.ITOP_REST_PASSWORD;
const ITOP_VERSION = process.env.ITOP_REST_VERSION ?? "1.3";

type Payload = { name: string; email: string; company: string; message?: string; website?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THROWAWAY = ["mailinator.com", "10minutemail.com", "guerrillamail.com", "yopmail.com"];

// Simple in-memory limit. Swap for Redis or Vercel KV before this goes live.
const seen = new Map<string, { n: number; since: number }>();
const WINDOW = 60 * 60 * 1000;
const LIMIT = 5;

function rateLimited(ip: string) {
  const now = Date.now();
  const rec = seen.get(ip);
  if (!rec || now - rec.since > WINDOW) {
    seen.set(ip, { n: 1, since: now });
    return false;
  }
  rec.n += 1;
  return rec.n > LIMIT;
}

async function createInITop(body: Payload) {
  if (!ITOP_URL || !ITOP_USER || !ITOP_PASSWORD) {
    return { ok: false, reason: "not configured" };
  }

  // The payload is built here, from known fields only. Client-supplied json_data
  // is never passed through — that would be an open write path into the CMDB.
  const json = {
    operation: "core/create",
    comment: "Demo request from weftbase.com",
    class: "UserRequest",
    output_fields: "id,ref",
    fields: {
      title: `Demo request — ${body.company}`,
      description: [
        `Name: ${body.name}`,
        `Email: ${body.email}`,
        `Company: ${body.company}`,
        body.message ? `Wants to see: ${body.message}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      origin: "portal",
    },
  };

  const form = new URLSearchParams({
    auth_user: ITOP_USER,
    auth_pwd: ITOP_PASSWORD,
    version: ITOP_VERSION,
    json_data: JSON.stringify(json),
  });

  const res = await fetch(ITOP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return { ok: false, reason: `http ${res.status}` };
  const data = await res.json();
  return { ok: data?.code === 0, reason: data?.message ?? "ok" };
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // honeypot: a real visitor never fills this
  if (body.website) {
    return NextResponse.json({ ok: true });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const email = (body.email ?? "").trim().slice(0, 200);
  const company = (body.company ?? "").trim().slice(0, 160);
  const message = (body.message ?? "").trim().slice(0, 2000);

  if (!name || !company || !EMAIL.test(email)) {
    return NextResponse.json({ error: "Please check your details" }, { status: 400 });
  }
  if (THROWAWAY.includes(email.split("@")[1]?.toLowerCase())) {
    return NextResponse.json({ error: "Please use a work email address" }, { status: 400 });
  }

  // Fail soft. If iTop is unreachable we still accept the lead, because losing a
  // sales enquiry because the CMDB was down would be the worse outcome.
  let itop = { ok: false, reason: "skipped" };
  try {
    itop = await createInITop({ name, email, company, message });
  } catch (err) {
    console.error("[demo-request] iTop unreachable:", (err as Error).name);
  }

  // TODO: send the sales notification (Resend or SES) — the fallback path.
  // Log the outcome only. Never log the visitor's details.
  console.log(`[demo-request] accepted | itop=${itop.ok ? "created" : "deferred:" + itop.reason}`);

  return NextResponse.json({ ok: true });
}
