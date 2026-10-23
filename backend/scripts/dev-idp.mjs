// A local OpenID Connect provider for developing and testing single sign-on
// without an Entra ID tenant. Development only: it signs in ANY email
// address typed into its form, with no password.
//
//   node scripts/dev-idp.mjs            # http://127.0.0.1:3027
//
// Settings (environment):
//   IDP_PORT           3027
//   IDP_CLIENT_ID      arcus-dev
//   IDP_CLIENT_SECRET  arcus-dev-secret
//   IDP_REDIRECT_URI   http://127.0.0.1:4000/api/auth/sso/callback (comma-separate several)
//
// Point the BFF at it (backend/.env):
//   OIDC_ISSUER=http://127.0.0.1:3027
//   OIDC_ALLOW_HTTP=true
//   OIDC_CLIENT_ID=arcus-dev
//   OIDC_CLIENT_SECRET=arcus-dev-secret
//   OIDC_REDIRECT_URI=http://127.0.0.1:4000/api/auth/sso/callback
//
// The sign-in form has a "used MFA" box: ticked, the ID token's `amr` claim
// is ["pwd","mfa"] (as Entra ID reports a sign-in with MFA), else ["pwd"].
// Consent is granted automatically.

import { createServer } from "node:http";
import Provider from "oidc-provider";

const port = Number(process.env.IDP_PORT ?? 3027);
const issuer = `http://127.0.0.1:${port}`;
const clientId = process.env.IDP_CLIENT_ID ?? "arcus-dev";
const clientSecret = process.env.IDP_CLIENT_SECRET ?? "arcus-dev-secret";
const redirectUris = (process.env.IDP_REDIRECT_URI ?? "http://127.0.0.1:4000/api/auth/sso/callback")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const provider = new Provider(issuer, {
  clients: [
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    },
  ],
  pkce: { required: () => true },
  // Any email is an account; its claims are made up from it.
  async findAccount(_ctx, id) {
    return {
      accountId: id,
      async claims() {
        return { sub: id, email: id, email_verified: true, name: id.split("@")[0] };
      },
    };
  },
  // amr (and auth_time) go in the ID token only when a scope lists them.
  claims: { openid: ["sub", "amr", "auth_time"], email: ["email", "email_verified"], profile: ["name"] },
  // Put the requested claims in the ID token, as Entra ID does.
  conformIdTokenClaims: false,
  features: { devInteractions: { enabled: false } },
  interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
  cookies: { keys: ["arcus-dev-idp-only"] },
  ttl: { Session: 60, Interaction: 600, Grant: 600 },
});
provider.on("server_error", (_ctx, error) => console.error("dev-idp:", error));

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(uid, params) {
  return `<!doctype html><meta charset="utf-8"><title>Dev IdP sign-in</title>
<style>body{font:15px system-ui;max-width:360px;margin:60px auto}input,button{font:inherit;padding:6px;width:100%;box-sizing:border-box;margin:6px 0}</style>
<h1>Dev IdP</h1><p>Development only. Signing in to <b>${escape(params.client_id)}</b>.</p>
<form method="post" action="/interaction/${escape(uid)}/login">
<label>Email<input name="email" type="email" required autofocus></label>
<label><input name="mfa" type="checkbox" value="1" style="width:auto"> used MFA (amr: mfa)</label>
<button type="submit">Sign in</button></form>`;
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

async function interaction(req, res, uid, action) {
  const details = await provider.interactionDetails(req, res);
  if (details.uid !== uid) throw new Error("interaction mismatch");

  if (details.prompt.name === "login" && action === "login" && req.method === "POST") {
    const form = await readForm(req);
    const email = (form.get("email") ?? "").trim();
    const amr = form.get("mfa") ? ["pwd", "mfa"] : ["pwd"];
    await provider.interactionFinished(req, res, { login: { accountId: email, amr } }, { mergeWithLastSubmission: false });
    return;
  }
  if (details.prompt.name === "login") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(uid, details.params));
    return;
  }
  // consent: granted without asking.
  const grant = details.grantId
    ? await provider.Grant.find(details.grantId)
    : new provider.Grant({ accountId: details.session.accountId, clientId: details.params.client_id });
  const missing = details.prompt.details;
  if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(" "));
  if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
  const grantId = await grant.save();
  await provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
}

const callback = provider.callback();
createServer((req, res) => {
  const match = /^\/interaction\/([^/?]+)(?:\/(login))?/.exec(req.url ?? "");
  if (!match) return callback(req, res);
  interaction(req, res, match[1], match[2]).catch((error) => {
    console.error("dev-idp interaction:", error);
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`Sign-in failed: ${error.message}`);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`dev-idp listening on ${issuer} (client ${clientId}; redirect ${redirectUris.join(", ")})`);
});
