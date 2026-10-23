// End-to-end check of sign-in: single sign-on against the local dev IdP,
// MFA (enrolment, codes, recovery codes) and the break-glass account, through
// a real BFF and the local iTop. No browser: it follows the redirects itself
// and keeps cookies like one.
//
//   node --import tsx scripts/e2e-sso.mjs
//
// It starts the dev IdP (scripts/dev-idp.mjs) and a BFF of its own, with
// backend/.env for the iTop connection and these overrides (environment):
//   E2E_BFF_PORT         3020
//   E2E_IDP_PORT         3027
//   E2E_APP_URL          http://127.0.0.1:5193   (where SSO lands; nothing needs to run there)
//   E2E_STAFF_LOGIN      admin; E2E_STAFF_PASSWORD (else docker/itop-install-params.xml)
//   E2E_ITOP_EXTERNAL_HEADER  set it (e.g. X-Arcus-Remote-User) once iTop's
//                        ext_auth_variable reads that header: staff SSO is then
//                        tested all the way; without it, the refusal is.
//
// To test staff SSO without changing the shared local iTop, run a second iTop
// container on the same code volume and database, with only its config file
// overridden (a copy of conf/production/config-itop.php adding
// 'ext_auth_variable' => "\$_SERVER['HTTP_X_ARCUS_REMOTE_USER']"):
//   docker run -d --name itop-sso-test -p 127.0.0.1:8100:80 -v docker_itop-local-code:/var/www/html \
//     -v <copy>:/var/www/html/conf/production/config-itop.php:ro --add-host host.docker.internal:host-gateway itop-dev:php8.3
//   ITOP_BASE_URL=http://127.0.0.1:8100 E2E_ITOP_EXTERNAL_HEADER=X-Arcus-Remote-User npm run e2e:sso
//   docker rm -f itop-sso-test
//
// Accounts it keeps in iTop (created once, passwords reset every run):
//   e2e.breakglass  local, Administrator   -- the break-glass account
//   e2e.portal      local, Portal user     -- shared with the browser tests
//   e2e.sso.agent@example.test  external, Service Desk Agent
// Sessions and enrolments live in the test BFF's memory: nothing is enrolled
// for real accounts.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BFF_PORT = Number(process.env.E2E_BFF_PORT ?? 3020);
const IDP_PORT = Number(process.env.E2E_IDP_PORT ?? 3027);
const BFF = `http://127.0.0.1:${BFF_PORT}`;
const IDP = `http://127.0.0.1:${IDP_PORT}`;
const APP = process.env.E2E_APP_URL ?? "http://127.0.0.1:5193";
const EXTERNAL_HEADER = process.env.E2E_ITOP_EXTERNAL_HEADER ?? "";
const BREAK_GLASS = "e2e.breakglass";
const PORTAL = "e2e.portal";
const SSO_AGENT = "e2e.sso.agent@example.test";

function installerAdminPassword() {
  try {
    const xml = readFileSync(resolve(root, "../docker/itop-install-params.xml"), "utf8");
    return /<admin_account>[\s\S]*?<pwd>([^<]*)<\/pwd>/.exec(xml)?.[1] ?? "";
  } catch {
    return "";
  }
}

// --- results -------------------------------------------------------------------

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// --- a browser-ish client: cookies (one jar per host, like a browser) and manual redirects ----

class Browser {
  cookies = new Map(); // name -> { value, path }

  cookieHeader(url) {
    const path = new URL(url).pathname;
    return [...this.cookies]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([name, c]) => `${name}=${c.value}`)
      .join("; ");
  }

  remember(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const path = attrs.find((a) => a.toLowerCase().startsWith("path="))?.slice(5) || "/";
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      const expired = /expires=thu, 01 jan 1970/i.test(line);
      if ((maxAge && Number(maxAge.slice(8)) <= 0) || expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, { value, path });
    }
  }

  async request(method, url, { body, form, headers = {} } = {}) {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookieHeader(url) ? { cookie: this.cookieHeader(url) } : {}),
        ...(body !== undefined ? { "content-type": "application/json", origin: APP } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
    });
    this.remember(response);
    return response;
  }

  async api(method, path, body) {
    const response = await this.request(method, `${BFF}${path}`, body === undefined ? {} : { body });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  }

  /** Follows redirects until one leaves for `stopAt` (the app) or a page answers. */
  async navigate(url, stopAt = APP) {
    let current = url;
    for (let hops = 0; hops < 20; hops += 1) {
      if (current.startsWith(stopAt)) return { url: current };
      const response = await this.request("GET", current);
      if (response.status >= 300 && response.status < 400) {
        current = new URL(response.headers.get("location"), current).href;
        continue;
      }
      return { url: current, status: response.status, html: await response.text() };
    }
    throw new Error("too many redirects");
  }

  /** The whole single sign-on round trip, signing in at the dev IdP as `email`. */
  async ssoSignIn(email, { mfa = false, returnTo = "/tickets" } = {}) {
    const page = await this.navigate(`${BFF}/api/auth/sso/start?returnTo=${encodeURIComponent(returnTo)}`);
    if (page.url.startsWith(APP)) return page.url;
    expect(page.html?.includes("Dev IdP"), `expected the IdP's sign-in page, got ${page.status} at ${page.url}`);
    const action = /action="([^"]+)"/.exec(page.html)[1];
    const response = await this.request("POST", new URL(action, page.url).href, {
      form: { email, ...(mfa ? { mfa: "1" } : {}) },
    });
    const next = new URL(response.headers.get("location"), page.url).href;
    const landed = await this.navigate(next);
    expect(landed.url.startsWith(APP), `the round trip ended at ${landed.url} (${landed.status}): ${landed.html?.slice(0, 200)}`);
    return landed.url;
  }
}

const code = (secret, offset = 0) => totpAt(secret, timeStep(Date.now()) + offset);

/** Password sign-in through the MFA step: enrols when asked. Returns the browser and the secret. */
async function passwordSignIn(login, password, secret) {
  const browser = new Browser();
  const res = await browser.api("POST", "/api/auth/login", { login, password });
  expect(res.status === 200, `sign-in as ${login}: ${res.status} ${JSON.stringify(res.json)}`);
  if (res.json.user) return { browser, secret, user: res.json.user };
  if (res.json.mfa.step === "enrol") {
    const enrol = await browser.api("GET", "/api/auth/mfa/enrol");
    secret = enrol.json.secret;
    const done = await browser.api("POST", "/api/auth/mfa/enrol", { code: code(secret) });
    expect(done.status === 200, `enrolment: ${done.status} ${JSON.stringify(done.json)}`);
    return { browser, secret, user: done.json.user, recoveryCodes: done.json.recoveryCodes };
  }
  const verify = await browser.api("POST", "/api/auth/mfa/verify", { code: code(secret, 1) });
  expect(verify.status === 200, `verify: ${verify.status} ${JSON.stringify(verify.json)}`);
  return { browser, secret, user: verify.json.user };
}

// --- processes -----------------------------------------------------------------

const children = [];
function start(name, args, env, readyText) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let log = "";
    const timer = setTimeout(() => reject(new Error(`${name} did not start:\n${log}`)), 60_000);
    const onData = (chunk) => {
      log += chunk;
      if (log.includes(readyText)) {
        clearTimeout(timer);
        resolveStart(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (exitCode) => reject(new Error(`${name} exited (${exitCode}):\n${log}`)));
  });
}

async function main() {
  const staffLogin = process.env.E2E_STAFF_LOGIN ?? "admin";
  const staffPassword = process.env.E2E_STAFF_PASSWORD || installerAdminPassword();
  expect(staffPassword, "Set E2E_STAFF_PASSWORD (no installer admin password found).");

  const callback = `${BFF}/api/auth/sso/callback`;
  await start("dev IdP", ["scripts/dev-idp.mjs"], { IDP_PORT: String(IDP_PORT), IDP_REDIRECT_URI: callback }, "dev-idp listening");
  await start(
    "BFF",
    ["--import", "tsx", "src/index.ts"],
    {
      PORT: String(BFF_PORT),
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
      SESSION_STORE: "memory",
      CORS_ORIGINS: APP,
      APP_BASE_URL: APP,
      MFA_REQUIRED: "staff",
      PASSWORD_SIGN_IN: "all",
      BREAK_GLASS_LOGINS: BREAK_GLASS,
      OIDC_ISSUER: IDP,
      OIDC_ALLOW_HTTP: "true",
      OIDC_CLIENT_ID: "arcus-dev",
      OIDC_CLIENT_SECRET: "arcus-dev-secret",
      OIDC_REDIRECT_URI: callback,
      OIDC_APP_URL: APP,
      SSO_MFA: "idp-or-totp",
      ITOP_EXTERNAL_AUTH_HEADER: EXTERNAL_HEADER,
    },
    "Server listening",
  );
  console.log(`BFF ${BFF}, dev IdP ${IDP}, staff SSO through iTop: ${EXTERNAL_HEADER ? `on (${EXTERNAL_HEADER})` : "off"}\n`);

  // 1. Password sign-in with MFA, as the staff (admin) account.
  let admin;
  await check("staff password sign-in asks to enrol, a pending sign-in reaches nothing", async () => {
    const browser = new Browser();
    const res = await browser.api("POST", "/api/auth/login", { login: staffLogin, password: staffPassword });
    expect(res.json?.mfa?.step === "enrol", `expected the enrol step, got ${JSON.stringify(res.json)}`);
    const me = await browser.api("GET", "/api/auth/me");
    expect(me.status === 401 && me.json.error.details?.mfa?.step === "enrol", `me: ${JSON.stringify(me.json)}`);
    const api = await browser.api("GET", "/api/admin/users?limit=1");
    expect(api.status === 401, `the API answered ${api.status} to a pending sign-in`);
    const wrong = await browser.api("POST", "/api/auth/mfa/enrol", { code: "000000" });
    expect(wrong.status === 409, `a code before the set-up step: ${wrong.status}`);
  });
  await check("staff enrols with an authenticator code and gets ten recovery codes", async () => {
    admin = await passwordSignIn(staffLogin, staffPassword);
    expect(admin.recoveryCodes?.length === 10, "no recovery codes");
    const mfa = await admin.browser.api("GET", "/api/auth/mfa");
    expect(mfa.json.enrolled && mfa.json.secondFactor === "totp", JSON.stringify(mfa.json));
  });
  await check("next sign-in asks for a code; a wrong code is refused; a recovery code works once", async () => {
    const browser = new Browser();
    await browser.api("POST", "/api/auth/login", { login: staffLogin, password: staffPassword });
    const wrong = await browser.api("POST", "/api/auth/mfa/verify", { code: "000000" });
    expect(wrong.status === 401 && wrong.json.error.details.attemptsLeft === 4, JSON.stringify(wrong.json));
    const recovered = await browser.api("POST", "/api/auth/mfa/verify", { recoveryCode: admin.recoveryCodes[0] });
    expect(recovered.status === 200, JSON.stringify(recovered.json));
    const again = new Browser();
    await again.api("POST", "/api/auth/login", { login: staffLogin, password: staffPassword });
    const reused = await again.api("POST", "/api/auth/mfa/verify", { recoveryCode: admin.recoveryCodes[0] });
    expect(reused.status === 401, `a used recovery code answered ${reused.status}`);
    const ok = await again.api("POST", "/api/auth/mfa/verify", { code: code(admin.secret, 1) });
    expect(ok.status === 200, JSON.stringify(ok.json));
  });

  // 2. The accounts the rest needs, made through the admin API.
  const passwords = { [BREAK_GLASS]: `Bg-${randomBytes(12).toString("base64url")}-7a`, [PORTAL]: `Pt-${randomBytes(12).toString("base64url")}-7a` };
  await check("test accounts exist (break-glass, portal, external SSO agent)", async () => {
    const { browser, user } = admin;
    const profiles = (await browser.api("GET", "/api/admin/profiles")).json.profiles;
    const profile = (name) => profiles.find((p) => p.name === name)?.id;
    async function ensure(login, type, profileNames, email, password) {
      const found = (await browser.api("GET", `/api/admin/users?q=${encodeURIComponent(login)}`)).json.items.find((u) => u.login === login);
      if (found) {
        if (found.status !== "enabled") await browser.api("PATCH", `/api/admin/users/${found.id}`, { status: "enabled" });
        if (password) {
          const set = await browser.api("POST", `/api/admin/users/${found.id}/password`, { password });
          expect(set.status === 200, `password of ${login}: ${JSON.stringify(set.json)}`);
        }
        return;
      }
      const [first, last] = login.split("@")[0].split(".").slice(-2);
      const created = await browser.api("POST", "/api/admin/users", {
        type,
        login,
        ...(password ? { password } : {}),
        contact: { firstName: first, lastName: last ?? "user", email, orgId: user.orgId },
        profileIds: profileNames.map(profile),
      });
      expect(created.status === 201, `creating ${login}: ${created.status} ${JSON.stringify(created.json)}`);
    }
    await ensure(BREAK_GLASS, "local", ["Administrator", "REST Services User"], `${BREAK_GLASS}@example.test`, passwords[BREAK_GLASS]);
    await ensure(PORTAL, "local", ["Portal user"], `${PORTAL}@example.test`, passwords[PORTAL]);
    await ensure(SSO_AGENT, "external", ["Service Desk Agent", "REST Services User"], SSO_AGENT);
  });

  // 3. Break-glass: password + mandatory TOTP, every use audited.
  await check("break-glass signs in with password + TOTP, and every use is in the audit log", async () => {
    const wrong = await new Browser().api("POST", "/api/auth/login", { login: BREAK_GLASS, password: "not-it" });
    expect(wrong.status === 401, `wrong password: ${wrong.status}`);
    const glass = await passwordSignIn(BREAK_GLASS, passwords[BREAK_GLASS]);
    expect(glass.recoveryCodes, "break-glass was not asked to enrol");
    const list = await glass.browser.api("GET", "/api/objects/Organization?limit=1");
    expect(list.status === 200, `break-glass API call: ${list.status}`);
    const log = (await admin.browser.api("GET", `/api/admin/sign-in-audit?login=${BREAK_GLASS}&limit=20`)).json.entries;
    const events = log.map((e) => e.event);
    for (const event of ["break_glass_refused", "mfa_enrolled", "break_glass_sign_in", "break_glass_request"]) {
      expect(events.includes(event), `no ${event} in ${events.join(", ")}`);
    }
    expect(log.some((e) => e.detail === "GET /api/objects/Organization -> 200"), "the request is not in the log");
  });

  // 4. Single sign-on.
  await check("SSO: the dev IdP publishes its metadata", async () => {
    const meta = await (await fetch(`${IDP}/.well-known/openid-configuration`)).json();
    expect(meta.issuer === IDP && meta.code_challenge_methods_supported.includes("S256"), JSON.stringify(meta).slice(0, 200));
    const options = await new Browser().api("GET", "/api/auth/options");
    expect(options.json.sso?.label, `options: ${JSON.stringify(options.json)}`);
  });
  await check("SSO: an email with no account is refused, and lands on sign-in with the reason", async () => {
    const landed = await new Browser().ssoSignIn("nobody.here@example.test");
    expect(landed.startsWith(`${APP}/login?sso_error=`), landed);
    expect(decodeURIComponent(landed).includes("No helpdesk account belongs to nobody.here@example.test"), landed);
  });
  await check("SSO: an end user signs in and lands where they were going", async () => {
    const browser = new Browser();
    const landed = await browser.ssoSignIn(`${PORTAL}@example.test`, { returnTo: "/portal/requests" });
    expect(landed === `${APP}/portal/requests`, landed);
    const me = await browser.api("GET", "/api/auth/me");
    expect(me.status === 200 && me.json.user.login === PORTAL && me.json.user.kind === "portal", JSON.stringify(me.json));
    const requests = await browser.api("GET", "/api/portal/requests");
    expect(requests.status === 200, `portal API: ${requests.status}`);
  });
  await check("SSO: the IdP's MFA claim (amr) reaches the session", async () => {
    const browser = new Browser();
    await browser.ssoSignIn(`${PORTAL}@example.test`, { mfa: true });
    const mfa = await browser.api("GET", "/api/auth/mfa");
    expect(mfa.json.signedInWith === "sso" && mfa.json.secondFactor === "idp", JSON.stringify(mfa.json));
    const plain = new Browser();
    await plain.ssoSignIn(`${PORTAL}@example.test`, { mfa: false });
    const none = await plain.api("GET", "/api/auth/mfa");
    expect(none.json.secondFactor === null, JSON.stringify(none.json));
  });
  await check("SSO: a forged state is refused", async () => {
    const browser = new Browser();
    const res = await browser.request("GET", `${BFF}/api/auth/sso/callback?code=x&state=forged`);
    expect(res.status === 302 && res.headers.get("location").includes("sso_error="), `${res.status} ${res.headers.get("location")}`);
  });
  await check("SSO: a disabled account is refused", async () => {
    const found = (await admin.browser.api("GET", `/api/admin/users?q=${PORTAL}`)).json.items.find((u) => u.login === PORTAL);
    await admin.browser.api("PATCH", `/api/admin/users/${found.id}`, { status: "disabled" });
    try {
      const landed = await new Browser().ssoSignIn(`${PORTAL}@example.test`);
      expect(decodeURIComponent(landed).includes("disabled"), landed);
    } finally {
      await admin.browser.api("PATCH", `/api/admin/users/${found.id}`, { status: "enabled" });
    }
  });

  if (EXTERNAL_HEADER) {
    await check("SSO: staff whose IdP sign-in used MFA (amr) are trusted and call iTop as themselves", async () => {
      const browser = new Browser();
      const landed = await browser.ssoSignIn(SSO_AGENT, { mfa: true });
      expect(landed === `${APP}/tickets`, landed);
      const mfa = await browser.api("GET", "/api/auth/mfa");
      expect(mfa.json.signedInWith === "sso" && mfa.json.secondFactor === "idp", JSON.stringify(mfa.json));
      const list = await browser.api("GET", "/api/objects/Organization?limit=1");
      expect(list.status === 200, `staff API as the SSO user: ${list.status} ${JSON.stringify(list.json)}`);
    });
    await check("SSO: staff whose IdP sign-in had no MFA must give our authenticator code", async () => {
      const browser = new Browser();
      const landed = await browser.ssoSignIn(SSO_AGENT, { mfa: false });
      expect(landed === `${APP}/login?next=%2Ftickets`, landed);
      const me = await browser.api("GET", "/api/auth/me");
      expect(me.json.error?.details?.mfa?.step === "enrol", JSON.stringify(me.json));
      const enrol = await browser.api("GET", "/api/auth/mfa/enrol");
      const done = await browser.api("POST", "/api/auth/mfa/enrol", { code: code(enrol.json.secret) });
      expect(done.status === 200 && done.json.user.login === SSO_AGENT, JSON.stringify(done.json));
    });
  } else {
    await check("SSO: staff are refused while iTop is not set up for external sign-in", async () => {
      const landed = await new Browser().ssoSignIn(SSO_AGENT, { mfa: true });
      expect(decodeURIComponent(landed).includes("not available to staff yet"), landed);
    });
  }

  await check("the sign-in audit log has the SSO sign-ins and refusals", async () => {
    const log = (await admin.browser.api("GET", "/api/admin/sign-in-audit?limit=100")).json.entries;
    expect(log.some((e) => e.method === "sso" && e.event === "sign_in" && e.login === PORTAL), "no SSO sign-in");
    expect(log.some((e) => e.method === "sso" && e.event === "sign_in_refused" && e.login === "nobody.here@example.test"), "no SSO refusal");
  });
}

main()
  .catch((error) => {
    failures.push("setup");
    console.error(error);
  })
  .finally(() => {
    for (const child of children) child.kill();
    console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join("; ")}` : ""}`);
    process.exit(failures.length ? 1 : 0);
  });
