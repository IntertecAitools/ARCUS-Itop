# Security review before go-live

Date: 2026-10-21. Scope: `backend/` (the BFF) and `frontend/` (the SPA and
its nginx image). The vendored `iTop/` was not reviewed. Branch
`claude/security-hardening-1b379d`.

How it was done: we read every route, the auth guard, session handling, the
iTop client, and every place OQL is built. Each suspected hole was tried
against the app in tests (`app.inject`), and the main ones against a live BFF
on :4300 over the local iTop. We ran `npm audit` in both packages.

## Fixed

| # | Severity | Finding | Fix | Tests |
| --- | --- | --- | --- | --- |
| 1 | **Critical** | **Percent-encoded paths bypassed the guard.** The guard checked the raw URL with prefix tests, but the router decodes `%61` to `a`. `GET /%61pi/objects/Person` with **no session** passed as "not an API path" and ran as the service account (an Administrator). `GET /api/%61dmin/users` gave any staff user the admin API. nginx's `location /api/` matches the decoded path and forwards the raw one, so both worked in production too. | The guard decides on the matched route (`request.routeOptions.url`, e.g. `/api/admin/users/:id`). A URL that matches no route goes to the 404 handler. | `auth.test.ts` "the guard, on encoded paths" (3); live: all three paths now 401 |
| 2 | High (defence in depth) | **Fallback to the service account.** Any iTop call with no staff credentials behind it (nobody signed in, or an end user) quietly ran as the Administrator service account. That is why #1 was so bad. | With `AUTH_REQUIRED`, `ItopClient` now refuses such a call (401/403) unless it says `asService` or runs inside `runAsServiceAccount`. The portal's writes and attachments now say so explicitly. | `client.test.ts` "credentials with sign-in required" (3) |
| 3 | High | **No limit on sign-in attempts.** Passwords could be guessed at full speed. | 10 failures per client address and 5 per login in 15 minutes, then `429 rate_limited` with `Retry-After` and "Too many failed sign-in attempts. Try again in N minutes." The check happens before iTop is asked. A success clears the login's count. A wrong *current* password on `POST /api/auth/password` counts too. The shared `RateLimiter` moved to `core/rate-limiter.ts`. | `auth.test.ts` "sign-in rate limiting" (3), "changing one's own password"; `rate-limiter.test.ts`; live (below) |
| 4 | Medium | **`TRUST_PROXY=true` let a client choose its address.** It trusts every hop, so the left-most `X-Forwarded-For` entry wins, and the client writes that one unless the TLS proxy replaces the header. That would defeat the per-address limits. | `TRUST_PROXY` now also takes a hop count or a list of proxy addresses/CIDRs. The compose file sets `2` (nginx + the TLS proxy). | `trust-proxy.test.ts` (2) |
| 5 | Medium | **Raw `?oql=` on list and export.** Any staff user could send any OQL. That skipped the schema allowlist (User, URP_\*, ActionEmail…; iTop's own read rights still applied). Inside `id IN (…)`, an unbalanced parenthesis also escaped the filters. The frontend never sent it. | The parameter is refused with 400. Lists go through `view` ids only. | `navigation.test.ts` "refuses raw OQL" (4 URLs) |
| 6 | Medium | **CSV formula injection.** End users set ticket titles in the portal. An export opened in Excel would run `=HYPERLINK(...)`. | A CSV export is rewritten so cells starting with `= + - @`, tab or CR get a leading `'`. Plain numbers stay as they are, and the UTF-8 BOM is kept. | `transfer.test.ts` "defuses spreadsheet formulas" |
| 7 | Low–Medium | **5xx answers leaked internals**: iTop's internal URL, the raw socket error, and up to 600 characters of the upstream page (PHP errors, paths) in `details`. | A 5xx carries a fixed message per code and no `details`. iTop's own message is kept when iTop answered (it is a rule the user can act on). The full error is still logged. | `routes.test.ts` "5xx answers" (2) |
| 8 | Low | **No security headers on the BFF; no CSP on the page.** | BFF: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP: default-src 'none'; frame-ancestors 'none'; sandbox`, `CORP: same-site`, and `Cache-Control: no-store` unless set. nginx: a CSP for the SPA (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, …) and a `Permissions-Policy`. The inline theme script moved to `/theme-init.js` so no inline script is needed. | `routes.test.ts` "security headers"; frontend build checked: no inline scripts left |
| 9 | Low | **Attachments were served with the uploader's declared type**, `text/html` and `image/svg+xml` included. The `attachment` disposition and `nosniff` already stopped stored XSS; the type would matter once a preview opens files in a tab. Also, a non-Latin-1 file name (`文件.pdf`) made the download a 500. | HTML/XML/SVG/JS and malformed types are served as `application/octet-stream`. `filename=` has an ASCII stand-in and `filename*` the real name. The new BFF CSP (`sandbox`) applies too. | `attachments.test.ts` "serves page-like uploads as opaque bytes" |
| 10 | Low | **Cross-origin writes with `CORS_ORIGINS=*`** were not origin-checked at all. Only `SameSite=Lax` protected them, and that does not stop a sibling subdomain. | With `*`, a write that carries an `Origin` must come from the server's own host. | `auth.test.ts` "cross-origin writes with CORS_ORIGINS=*" |
| 11 | Low | **The default-organisation cache followed the first caller.** A signed-in user without an organisation had the default worked out as them (their contact, their view of organisations). The result was then cached for everyone after them. | For such a user, the default is worked out as the service account with nobody bound, so it is the same for all. | `default-organization.test.ts` |
| 12 | Low | **Re-linking an account to another person kept its sessions.** The inbox and portal scope by the contact held in the session. | Changing `contactId` signs the account out everywhere, like profile or status changes. | `users-admin.test.ts` |
| 13 | Low | **`constructor`, `toString`… passed for field codes and dashboard ids**: `?constructor=x`, criteria on `constructor` and `/api/meta/dashboards/constructor` gave 500s. There was no injection; the value was still an identifier. | Schema field maps have no prototype, and dashboard lookups use own keys only. | `routes.test.ts` "Object.prototype names" |
| 14 | Low | `fields` on a link list for a class outside the schema went to iTop unchecked. | Each code must be an identifier (or `*`). | covered by existing link tests |

### Live check (BFF on :4300, local iTop, MySQL sessions)

- Good sign-in → 200. Five wrong passwords for one login → 401 each. The 6th
  → **429**, `Retry-After: 887`, "Too many failed sign-in attempts. Try again
  in 15 minutes."
- Wrong passwords for other logins from the same address → 401 up to the
  10th failure from that address, then 429 for every login, including the
  right password (by design: the address is locked).
- After a restart (the counters are in memory): 4 failures on the real login,
  then the right password → 200. Then 5 more failures → 401 (the count had
  been cleared), the next attempt with the right password → 429.
- `/%61pi/admin/users`, `/api/%61dmin/users`, `/%61pi/objects/Person` → 401
  without a session.
- API responses carry `X-Frame-Options: DENY`,
  `CSP: default-src 'none'; frame-ancestors 'none'; sandbox`, and
  `Cache-Control: no-store`.

## Checked and judged sound

- **Sessions**: 256-bit random ids. A new id on every sign-in, so no fixation.
  Deleted on sign-out. In MySQL the id is stored as a SHA-256 and the payload
  sealed (scrypt-derived key, bound to the row). Idle and absolute timeouts.
  Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` with
  `COOKIE_SECURE=true`.
- **Staff access**: staff call iTop with their own credentials, so iTop
  enforces their profiles and organisations. The guard keeps end users to
  `/api/auth/*`, `/api/portal/*` and `/api/me/*`, and `/api/admin/*` to
  administrators.
- **Portal**: every query is narrowed by `PortalService.scope` (their tickets
  as caller; their organisation's for "Portal power user"; UserRequest and
  Incident only). Every write re-reads the ticket inside that scope first.
  Attachments resolve the host through the same scope. Services come from the
  organisation's contracts. FAQs are public to every end user, as in iTop's
  portal.
- **OQL**: every user literal goes through `quoteString`/`likeContains`, which
  match iTop's lexer. Identifiers go through `assertIdentifier` and the
  schema, ids through zod ints or `Number()`, criteria through `criteria.ts`.
  Every `asService` query outside auth and the portal is pinned to the
  caller's contact or to numeric ids.
- **Password reset**: 256-bit single-use tokens, stored hashed. The same
  answer whether or not the account exists. Rate-limited. A reset signs the
  account out everywhere.
- **Logs**: no logger call includes credentials. `authorization`, `cookie`,
  `auth_pwd` and `password` are redacted. Request ids are not taken from the
  client.
- **Uploads**: a 32 MiB cap in the parser and the service, and 10 MB for
  imports. File names are stripped of path parts, control characters and
  quotes.
- **Frontend**: iTop HTML is rendered as text (`toPlainText`), never with
  `dangerouslySetInnerHTML`. No tokens are kept in storage (the session is an
  `HttpOnly` cookie). Downloads go through blobs with `download`.
- **`npm audit`, backend**: 0 vulnerabilities.

## Accepted or out of scope

- **Limits are per BFF instance.** The counters are in memory. With N
  instances, a client gets each limit N times, and a restart resets them.
  That is still a hard cap on guessing. A shared store (the session MySQL)
  would make them global; not needed for one instance.
- **The per-login limit can lock out a user.** Anyone can make 5 wrong
  attempts against someone else's login and block it for 15 minutes. That is
  the usual trade-off of a per-account limit; the per-address limit alone
  would let a botnet guess one account freely. An administrator cannot clear
  a lock early; restarting the BFF does.
- **`npm audit`, frontend**: 6 advisories (2 critical, 1 high, 3 moderate),
  all in **dev tooling**: vitest 2 → tinypool, vite, esbuild, vite-node,
  @vitest/mocker. They affect the Vite dev server and the Vitest UI, not the
  production image, which is the static build behind nginx. The fix is
  vitest 5 (a major upgrade with config changes): recommended as a separate
  change, not done here.
- **Duplicate headers through nginx**: the BFF sets its headers and nginx
  adds its own server-level ones to `/api/` responses. Both are strict, and
  browsers apply both CSPs, so this is harmless.
- **HSTS** belongs on the TLS proxy (`docs/deployment.md`, "HTTPS
  everywhere"), not on this HTTP-only nginx.
- **`style-src 'unsafe-inline'`** in the page CSP covers the style attributes
  chart code sets. Script stays `'self'` only.
- **Hint text on the service-account 403** names `ITOP_USER`/`ITOP_PASSWORD`.
  It only appears when the BFF's own account is misconfigured, which is an
  operator's problem.
- **Admin APIs** trust administrators to the extent iTop does (profiles,
  organisations, accounts). Input is validated: numeric ids, a login regex,
  passwords of 8+ characters.
