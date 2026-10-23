# Intertec Helpdesk — Backend

A backend-for-frontend over the iTop 3.4 REST/JSON API.

It exists so our frontend can talk to a normal HTTP API — real status codes,
pagination, typed schema metadata, safe writes — instead of iTop's
RPC-over-form-POST endpoint. **iTop itself is never modified**; it is the system
of record and this layer is the only thing that speaks to it.

```
frontend  ──HTTP/JSON──>  backend  ──form POST──>  iTop/webservices/rest.php
  :5173                    :4000                        :8080
```

Our code lives in exactly two folders: `frontend/` and `backend/`. `iTop/` is
vendored upstream and `docker/` is infrastructure — neither is ours to edit.

---

## Quick start

```bash
cp .env.example .env     # then set ITOP_PASSWORD
npm install
npm run dev              # http://127.0.0.1:4000
```

Verify it:

```bash
curl http://127.0.0.1:4000/health            # liveness, no backend needed
curl http://127.0.0.1:4000/health/upstream   # proves it can reach + auth to iTop
npm run smoke                                # read-only end-to-end check
npm run smoke -- --write                     # also creates/deletes one throwaway object
```

### The one piece of iTop setup you cannot skip

`secure_rest_services` defaults to **true** (`core/config.class.inc.php:1621`),
so the account in `ITOP_USER` **must hold the "REST Services User" profile**.
Without it every call returns iTop code `1` and this BFF answers `403`.

**Code `1` means two different things**, and only the message distinguishes them
(`webservices/rest.php:110-130`):

| iTop message | Actual cause |
|---|---|
| `Invalid login` | wrong `ITOP_USER` / `ITOP_PASSWORD` — *not* the profile |
| `This user is not authorized to use the web services…` | account exists, profile missing |

Also worth knowing: iTop 3.4 on PHP 8.2+ raises a deprecation inside
`CoreServices->ExecOperation`, and with `display_errors` on PHP prints it
*before* the JSON, so every REST response is corrupted and `header()` fails.
Keep `display_errors = Off` (see `docker/php.ini`).

Token auth is not an alternative here: `allow_rest_services_via_tokens` defaults
to `false` and no token-auth module is installed in this instance.

---

## Sign-in

Everyone signs in to **our** frontend; nobody needs iTop's console. Accounts
are still iTop's own (`UserLocal`, `UserLDAP`, `UserExternal`), so there is one
user list.

- `POST /api/auth/login` checks the password with `core/check_credentials`
  (local, LDAP and external accounts alike), reads the account's profiles and
  allowed organisations, and sets an `HttpOnly`, `SameSite=Lax` session cookie.
  `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/password`.
- **Failed sign-ins are limited**: 10 per client address and 5 per login in
  15 minutes; past that the answer is `429 rate_limited` with `Retry-After`,
  checked before iTop is asked. A successful sign-in clears its login's count;
  a wrong current password on `POST /api/auth/password` counts against the
  login too. The counters live in memory, so they are **per BFF instance**
  and reset on restart. The client address is `request.ip`, which follows
  `TRUST_PROXY` (see `docs/deployment.md`).
- **The guard decides on the matched route**, not the raw URL (the router
  decodes `%61` to `a`), and the iTop client refuses a call that has no staff
  user behind it unless it is explicitly made as the service account.
- **Staff call iTop as themselves.** The session holds their credentials
  (iTop's REST API needs them on every call and no token module is
  installed), never in readable form outside the BFF's memory, so iTop enforces their profiles and organisations and
  history shows their name. This is why staff accounts need iTop's
  `REST Services User` profile; the user-admin API adds it automatically.
- **End users** ("Portal user" profile) are refused by iTop's REST API, so they
  use the self-service API, `/api/portal/*`, and the guard keeps them to it.
  It runs as the service account, so `PortalService` is the access control:
  it applies iTop's own portal scopes (their tickets as caller, or their
  organisation's for "Portal power user"; services from their organisation's
  customer contracts) and re-reads every ticket inside that scope before a
  write. Comments are written on the user's behalf (case-log `add_item` with
  their user id), so they carry the user's name.
  Endpoints: requests (list, raise, read, comment, close with satisfaction,
  reopen, attachments), catalogue, FAQs, own profile (phone numbers).
- Every `/api` route except sign-in needs a session; `/api/admin/*` needs the
  Administrator profile; writes from an origin outside `CORS_ORIGINS` are refused.
- **Where sessions live** (`SESSION_STORE`):
  - `memory` (default): a BFF restart signs everyone out, and only one BFF
    instance can run. Fine for development.
  - `mysql`: sessions survive restarts and are shared by every instance. They
    are kept in table `bff_sessions` (created on start) of a database of their
    own (`SESSION_DB_NAME`, default `arcus_bff`; create it first), not
    iTop's. Each row is sealed with AES-256-GCM under `SESSION_SECRET`, which
    stays in the BFF's environment, and is keyed by a SHA-256 of the cookie,
    so the table alone yields neither a password nor a usable cookie.
    Changing `SESSION_SECRET` signs everyone out. The BFF refuses to start if
    the database cannot be reached.
- **Forgot password by email** (on once `SMTP_HOST` is set; see `.env.example`):
  `GET /api/auth/options`, `POST /api/auth/forgot-password` (login or email),
  `POST /api/auth/reset-password` (token, new password).
  - The answer never says whether an account exists; the email is sent after
    it. Only enabled local accounts with an email address get one.
  - A link carries 256 random bits in the URL fragment (never sent to a
    server), is stored only as a SHA-256, works once, expires
    (`PASSWORD_RESET_MINUTES`, default 30), and a newer request replaces it.
    It stays usable if iTop refuses the new password.
  - A reset signs the account out everywhere.
  - Requests are limited per client address (10 per 15 minutes, a 429) and
    per account (3, silently). Limits are per BFF instance; set
    `TRUST_PROXY=true` behind a reverse proxy so addresses are real.
  - Mail goes over TLS (`SMTP_REQUIRE_TLS`, off only for a local test mailbox).
  - Other settings: `AUTH_REQUIRED`, `SESSION_IDLE_MINUTES`,
    `SESSION_MAX_HOURS`, `COOKIE_SECURE` (on behind HTTPS).

### iTop accounts the BFF needs

Both are still required: iTop's REST API accepts only accounts with the
**REST Services User** profile (`secure_rest_services` is on by default), and
its token login is not installed.

| Account | Profiles | Why | How it gets them |
| --- | --- | --- | --- |
| Service account (`ITOP_USER`) | Administrator + REST Services User | Sign-in lookups, user admin, the end-user portal (iTop's REST API refuses portal accounts), comments written in a portal user's name, password resets | **By hand, once per iTop install.** The API cannot give REST Services User to an account that lacks it: see step 3 of "Local iTop" below |
| Every staff account | REST Services User (plus their own) | Staff call iTop as themselves, so iTop applies their rights and History shows their name | **Automatic** when the account is created or saved from **Users** in the frontend |
| Portal (end-user) accounts | Portal user | Served by `/api/portal/*` through the service account | Never given REST Services User |

- Accounts created in iTop before the platform was set up lack REST Services
  User. Signing in then says so ("it needs the REST Services User
  profile"); open the account in **Users** and save it to add the profile.
- After the service account is ready, the first administrator (the
  installer's `admin` will do) signs in and creates everyone else from
  **Users** (`/api/admin/users`, `/api/admin/profiles`). Nobody needs to open
  iTop for this.

## Multi-tenancy

One platform can serve several customers (`TENANCY=on`). A **tenant** is a
customer: an id, a name, the host names of its site, and the iTop
organisations that are its own. Everything a tenant's users do in iTop is
limited to those organisations; iTop itself knows nothing of tenants.

- **Where tenants live.** In the BFF database (`SESSION_STORE=mysql`), tables
  `bff_tenants`, `bff_tenant_domains`, `bff_tenant_orgs`, created on first
  use; or in `TENANTS_FILE` (a JSON array) without a database. An
  organisation and a domain belong to one tenant at most (they are the
  primary keys). Each instance rereads the tables every 30 seconds.
  `npm run tenants -- list | set <id> --name N --domain D --org N … |
  enable | disable | remove`.
- **Which tenant a request is for** (`platform/tenancy/resolve.ts`), decided
  in the sign-in guard from the request's host name and the signed-in user:
  - the user's tenant is the one owning their person's organisation, else the
    one owning all their allowed organisations (`tenantOfUser`, which reads
    only `login`, `orgId` and `allowedOrgIds`, so any sign-in method that
    fills those works);
  - on a tenant's domain only its own users can sign in or use a session;
  - a user no tenant claims is refused, except a platform operator
    (`PLATFORM_LOGINS`): unscoped on the platform's own address, held to the
    tenant on a tenant's domain;
  - a disabled tenant is refused.
- **One enforcement point.** Every service talks to iTop through
  `TenantScopedClient` (`platform/tenancy/scoped-client.ts`), wrapped around
  the iTop client in `services.ts`. While a tenant is bound to the request
  nothing reaches iTop unscoped:
  - *Reads*: the key of every `core/get` (an id, criteria or any OQL) is
    rewritten to `SELECT C WHERE id IN (<the query>) AND <tenant condition>`.
    Lists, searches, pickers, dashboards, nav counts, audits, saved queries
    and history all read this way, so another tenant's record is simply not
    found, by a guessed id too.
  - *Writes*: updates, deletes and transitions use the same scoped key (a
    404 for another tenant's record). Creates and the fields of updates are
    checked: the organisation and every key they set (caller, CI, contact,
    link-set rows such as an account's allowed organisations) must point
    inside the tenant; a key given as criteria is resolved there.
  - *Impact graphs*: the root must be the tenant's; other tenants' records
    are cut out of the answer.
  - *Exports*: the OQL is scoped. *Imports* run only as a user iTop itself
    holds to the tenant (not an Administrator, allowed organisations all the
    tenant's), since iTop's CSV import reconciles against what it can see.
- **Whose records are whose** (`platform/tenancy/scope-rules.ts`), following
  iTop's own silos and extending them where iTop leaves records open:
  `Organization` by id; classes with `org_id` by it; accounts by their
  person's organisation; attachments by `item_org_id`; link rows by every key
  they hold; saved queries by owner (no owner: shared, read-only); history by
  the record it is about. Reference data with no organisation (brands,
  models, FAQs, profiles, audit rules) is shared: read by every tenant,
  changed only by the platform operator. Platform configuration
  (notification triggers and actions, the email log) and any class the
  rules do not know are refused.
- **Accounts.** An account can only be given organisations of its own
  tenant (the one owning its person's organisation); an empty list becomes
  the tenant's organisations, so iTop's silos hold the account too.
- `runUnscoped()` stands the guard down; it is used only to find the
  account behind a sign-in.
- Test data: `npm run tenants -- seed-test` creates two tenants in a local
  iTop, and `npm run e2e:tenancy` proves neither can reach the other's
  records through the BFF.

## Notifications

Email rules ("when a User Request enters Resolved, email the caller") are
managed from **Notifications** in the frontend, administrators only:
`/api/admin/notifications/rules` (list, get, create, `PUT` edit, `PATCH
…/status`, delete), `/api/admin/notifications/options?recordType=`, and
`/api/admin/notifications/sent` (iTop's log of sent emails).

- **iTop sends them**, not the BFF: it is the only place that sees every
  change, including its own background jobs (SLA escalations, auto-resolve).
  So iTop needs its own mail settings (see "Switching to the real mail
  server" below).
- A rule is one iTop `lnkTriggerAction`: a Trigger (when) linked to an
  ActionEmail (what). The BFF translates both ways; the frontend never sees
  OQL or `$this->…$` placeholders:
  - events: created, changed (optionally only some fields), deleted, enters
    or leaves a status, SLA timer (TTO/TTR) at 75% or 100%;
  - recipients: the caller, the assigned agent, the assigned team, specific
    people, combined into one `SELECT Person WHERE … OR …` query. Parts of a
    query set up in iTop that do not match are kept as they are;
  - texts: plain text with `{{ref}}`-style fields; `{{link}}` points at
    `APP_BASE_URL/records/<type>/<id>`, never at iTop. iTop's own
    `$this->hyperlink()$` reads back as `{{link}}`, so saving an old rule
    moves its link to the platform;
  - every rule is sent from `NOTIFICATION_FROM` (default `MAIL_FROM`).
- Rules on events only iTop's own screens raise (@mentions in iTop's editor,
  updates from iTop's portal) are listed and editable but marked: nothing
  done in this platform fires them.
- **"Only when…" conditions** are the advanced-search criteria (same
  operators, same value checks, `platform/objects/criteria.ts`), written as
  the trigger's `filter`: `SELECT <Class> WHERE … AND …`. They are read
  back from that filter (`platform/admin/conditions.ts`); parts set up in
  iTop that are not in that form are kept and ANDed back unless the user
  removes them. Dates are not offered: a trigger fires at one moment.
- **In the app (the bell).** A rule can also notify in the app's bell: the
  BFF keeps one iTop `ActionNewsroom` on the rule's trigger, to the email's
  To recipients, titled with its subject. It goes with the last email rule
  on that trigger.

## The bell (in-app notifications)

`GET /api/me/notifications` (newest first, with the unread count),
`GET /api/me/notifications/count` (polled for the badge),
`POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`.
Open to staff and end users (`/api/me/` passes the guard for both).

- They are iTop's newsroom events (`EventNotificationNewsroom`), one per
  recipient. Read with the service account (ordinary profiles may not), so
  the service is the access control: every query is pinned to the caller's
  own contact, and marking one read first re-reads it under that pin.
- Each opens the record it is about in the platform (Incidents in their
  module, others as records, a User Request in the portal for end users),
  not iTop's URL.
- iTop writes datetimes as local text in its own time zone
  (`ITOP_TIMEZONE`, default `Europe/Paris`, iTop's default). The BFF sends
  exact ISO times, so "5 minutes ago" is right in any browser (see
  "Datetimes have no time zone" below).


Without a shared iTop, run one from this repository's own `iTop/` copy:

1. Build the image and fill the code volume, then start it — the commands are
   at the top of `docker/docker-compose.local.yml` (port 8080; data in the
   Windows MySQL, database `itop_prod`).
2. Run iTop's setup once, inside the container, with a response file made
   from `docker/itop-add-incident.xml` with `<mode>install</mode>` and
   `<url>http://localhost:8080/</url>` (46 modules: CMDB, ITIL requests and
   incidents, changes, problems, known errors, FAQ):
   `docker exec -u www-data -w /var/www/html/setup/unattended-install itop-local php unattended-install.php --param-file=/tmp/install.xml`,
   then `docker restart itop-local`.
3. Give the setup's `admin` account the **REST Services User** profile. The
   REST API cannot do this before the account has it; a one-off PHP script
   in the container (`UserRights::Login('admin')`, then a new
   `URP_UserProfile` linking `admin` to that profile) does.
4. `cp .env.example .env`, set `ITOP_USER`/`ITOP_PASSWORD` to that account,
   `npm run dev`, then `npm run smoke` and `npm run api:check`.
5. iTop's background jobs (`cron.php`: TTO/TTR escalations, auto-close,
   queued email, the bell's newsroom) run in `itop-local-cron`, started by
   the same compose file as the account in `backend/.env`
   (`ITOP_USER`/`ITOP_PASSWORD`, an Administrator). Without it no SLA
   threshold ever fires. Start it alone with
   `docker compose -f docker/docker-compose.local.yml up -d itop-local-cron`.
6. Email goes to **Mailpit**, a test mailbox started with iTop by the same
   compose file: every message the BFF or iTop sends lands at
   http://localhost:8025 and reaches nobody. Two places point at it:
   - the BFF, in `backend/.env`: `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`,
     `SMTP_REQUIRE_TLS=false`, plus `MAIL_FROM` and `APP_BASE_URL`;
   - iTop itself (its notifications), in
     `/var/www/html/conf/production/config-itop.php` inside the container:
     `'email_transport' => 'SMTP'`, `'email_transport_smtp.host' => 'mailpit'`,
     `'email_transport_smtp.port' => 1025`,
     `'email_transport_smtp.encryption' => ''`, and
     `email_default_sender_address` / `_label`. The file is read-only;
     `chmod u+w` it, edit, `chmod u-w`, then check with `php -l`.

### Switching to the real mail server

Change **both** places; they send different emails (the BFF: password
resets; iTop: ticket notifications).

| | BFF (`backend/.env`) | iTop (`config-itop.php`) |
| --- | --- | --- |
| Server | `SMTP_HOST=smtp.office365.com` | `'email_transport_smtp.host' => 'smtp.office365.com'` |
| Port | `SMTP_PORT=587` | `'email_transport_smtp.port' => 587` |
| Encryption | remove `SMTP_REQUIRE_TLS=false` (TLS is then required) | `'email_transport_smtp.encryption' => 'tls'` |
| Account | `SMTP_USER`, `SMTP_PASSWORD` | `'email_transport_smtp.username'`, `'email_transport_smtp.password'` |
| Sender | `MAIL_FROM` | `email_default_sender_address`, `email_default_sender_label` |

If the mail provider requires OAuth instead of a password (Microsoft 365
may), iTop has `'email_transport' => 'SMTP_OAuth'`; the BFF needs OAuth
support added first.

## Audit

iTop's data-quality audit is run from **Audit** in the frontend,
administrators only:

- `GET /api/admin/audit` lists domains and categories, each category with
  its rules (name, description, the record type it checks, its good/warning
  tolerances, and whether a rule lists the `faulty` or the `valid` records).
- `POST /api/admin/audit/categories/:id/run` runs every rule of a category.
- `POST /api/admin/audit/rules/:id/run` runs one rule against its category.

A run returns the size of the category's set, how many records fail at least
one rule, and per rule: the failing count, percent OK, a status (`good`,
`warning`, `bad`, from the category's tolerances as iTop colours them) and
the failing records (id, class, name; the first 500, with `truncated` when
there are more). A rule whose query iTop cannot run comes back with an
`error` instead of a count, as on iTop's own page.

Counting mirrors `pages/audit.php`: a rule listing faulty records fails
those that are also in the category's set; a rule listing valid records
fails every record of the set it does not return. Queries are read with the
administrator's own rights and never leave the BFF. Rules run one at a time.

Categories, rules and domains are also created, edited and deleted from
there, in the same vocabulary as notification conditions (no OQL either way):

- `GET /api/admin/audit/options` lists the record types a category may check.
- `GET /api/admin/audit/categories/:id`, `POST /api/admin/audit/categories`,
  `PUT /api/admin/audit/categories/:id`: a category is `{ name, description,
  recordType, conditions, keepCondition, tolerance: { good, warning },
  domains: [domainId] }`. Its set is "every `recordType` where all
  conditions hold" (`SELECT Server` when there are none). `domains` is the
  full list: links to other domains are removed. The record type cannot
  change while the category has rules.
- `DELETE /api/admin/audit/categories/:id` answers **409** naming the rules
  that would go with it (`details.rules`); `?withRules=true` deletes those
  rules, then the category (iTop refuses to delete a category that still has
  rules). Its domain links go with it.
- `GET /api/admin/audit/rules/:id`, `POST /api/admin/audit/rules`,
  `PUT /api/admin/audit/rules/:id`, `DELETE /api/admin/audit/rules/:id`: a
  rule is `{ categoryId, name, description, lists: "faulty" | "valid",
  conditions, keepCondition }`, its conditions on the category's record type
  (at least one). It may move only to a category of the same record type.
- `POST /api/admin/audit/domains`, `PUT /api/admin/audit/domains/:id`,
  `DELETE /api/admin/audit/domains/:id` (`{ name, description }`). Deleting a
  domain keeps its categories.

Conditions are the advanced-search criteria, translated by
`platform/admin/conditions.ts` as for notification rules. The editors read
back `conditions`, `keptCondition` (part of the query was set up in iTop and
cannot be shown: it is written back unchanged, ANDed with the conditions,
unless `keepCondition: false`) and `valueLabels` (names of the records key
conditions point at). Conditions on dates are refused, since a fixed date
cannot be read back as a condition.

## Saved queries

iTop's query phrasebook (`QueryOQL`) and its "Run queries" page, from
**Queries** in the frontend, for all staff (`platform/queries/`):

- `GET /api/queries` (every saved query), `GET /api/queries/:id`,
  `GET /api/queries/options` (record types), `POST /api/queries`,
  `PUT /api/queries/:id`, `DELETE /api/queries/:id`. A query is
  `{ name, description, recordType, conditions, columns }` (conditions are the
  advanced-search criteria, written and read back by
  `platform/admin/conditions.ts` as for notifications and the audit; no dates)
  or, **administrators only**, `{ name, description, oql, columns }`.
- `GET /api/queries/:id/results?page&limit&fields&sort&order` answers in the
  records list shape (plus `recordType`, `columns`);
  `POST /api/queries/run` (`{ query, page, limit, fields }`) runs one without
  saving it; `GET /api/queries/:id/export?format=csv|xlsx|pdf&fields=` is the
  records export, through iTop's exporter.
- **Runs and exports are always made as the caller**, so iTop applies their
  profiles and organisations; `:current_contact_id` / `:current_user_id` are
  bound to them. Never as the service account.
- iTop gives only administrators rights on `QueryOQL`, so the phrasebook is
  **read with the service account**; OQL is sent to administrators only (the
  DTO says `mode: "conditions" | "oql"`). Administrators write as
  themselves. Other staff may save condition queries and change or delete only
  their own (`owner_id` is their contact); those writes go through the service
  account with the BFF as the access control, and the OQL written is built by
  the BFF.
- Administrator OQL is run by iTop (one row, as the administrator) before it
  is saved or run; a refusal is a 400 with iTop's own reason ("Unknown filter
  code - found 'x' at 20 …"). A query must list a class the platform has
  screens for. Queries that need values from a notification
  (`:this->agent_id`, iTop's predefined ones) are listed with
  `runnable: false`.
- iTop requires a description: the name stands in when none is given.

## Problems

Problem management on top of the generic record screens (`modules/problems/`;
the problem record itself, its lifecycle and links stay on
`/api/objects/Problem`). In the frontend: a **Root cause** tab on a problem,
and **Problem trends** in the sidebar.

| | |
| --- | --- |
| `GET /api/problems/:id/analysis` | Root cause, workaround, resolution; the known errors raised from the problem; `available: false` when the iTop lacks the extension below |
| `PUT /api/problems/:id/analysis` | `{ rootCause, workaround, resolution }`; writes only what changed. 409 without the extension |
| `POST /api/problems/:id/known-errors` | `{ name?, symptom?, domain?, errorCode? }` → 201. Creates a KnownError with the analysis copied (resolution as its `solution`), `problem_id` pointing back, the problem's CIs linked, and the symptom taken from the problem's description unless given. 400 until a root cause or workaround is saved; 409 without the extension |
| `GET /api/problems/trends?period=30d\|90d\|180d\|365d&groupBy=service\|ci\|category` | Incidents and problems opened in the period, per week (up to 90 days) or month, and per service, CI or service subcategory: how many incidents are linked to a problem, the problems involved, and whether the group is **recurring** (3+ incidents in 2+ buckets). Reads at most 5,000 of each, else `truncated: true` |

### The arcus-problem-rca iTop extension

iTop's Problem has no root cause, workaround or solution: only KnownError
does. `itop-extensions/arcus-problem-rca/` is a small iTop extension of our
own that adds them to Problem (`root_cause`, `workaround`, `solution`, all
AttributeText like KnownError's, in a "Root cause analysis" fieldset). It
changes no other class and nothing in `iTop/`.

The BFF reads and writes these three fields itself, straight through the
tenant-scoped client; they are deliberately **not** in `cmdb-schema.json`.
So an iTop without the extension keeps working everywhere (iTop leaves an
unknown attribute out of a read): only the Root cause tab says the fields
are missing, and saving or raising a known error answers 409. Do not
re-extract the schema from an iTop that has the extension unless every iTop
the BFF talks to has it: the generic screens would then ask every iTop for
the fields.

Installing it on an iTop (an **upgrade**: data is kept, but iTop is in
maintenance mode for the few minutes the setup runs, and the datamodel is
recompiled; back up the database first):

1. Copy the folder into the iTop's `extensions/`:
   `docker cp itop-extensions/arcus-problem-rca <container>:/var/www/html/extensions/`
   then `docker exec <container> chown -R www-data:www-data /var/www/html/extensions/arcus-problem-rca`.
2. Check the module list in `docker/itop-problem-rca-upgrade.xml` against
   the modules that iTop has installed (it is the local iTop's list plus
   `arcus-problem-rca`); set `<database><name>` and `<url>`.
3. Copy the file in and run the unattended upgrade:
   `docker cp docker/itop-problem-rca-upgrade.xml <container>:/tmp/` and
   `docker exec -u www-data -w /var/www/html/setup/unattended-install <container> php unattended-install.php --param-file=/tmp/itop-problem-rca-upgrade.xml`.
   A failed run leaves iTop in maintenance: fix the cause, delete
   `data/.maintenance`, run it again.
4. Check: `npm run e2e:problems` reports "this iTop has the
   arcus-problem-rca extension" and passes.

For production, add the folder to the iTop image's `extensions/` before the
first install, and `arcus-problem-rca` to the install's module list.

## What this layer is actually for

Five upstream behaviours make a direct browser-to-iTop integration painful.
Each is handled here once, rather than in every frontend.

### 1. iTop returns HTTP 200 for everything

Failures come back as `200` with a `code` field in the body
(`RestResult.php`). A browser `fetch` sees success and a frontend has to
re-implement the mapping. `src/itop/codes.ts` maps those codes onto real
statuses, including two cases iTop collapses into the generic
`INTERNAL_ERROR` (100):

| iTop | Meaning | BFF status |
|---|---|---|
| `0` | OK | 200 |
| `1` | unauthorized / insufficient rights | 403 |
| `12` | UNSAFE — delete would cascade | 409 |
| `13` | invalid page | 400 |
| `100` + `"Invalid object …"` | object missing | **404** |
| `100` + `"Several items found …"` | ambiguous key | **409** |
| `100` otherwise | genuine upstream fault | 502 |
| `2`–`6`, `10`, `11` | malformed request — a bug *here* | 500 |

### 2. Writes silently require a `comment`

`RestUtils::InitTrackingComment` calls `GetMandatoryParam($oData, 'comment')`,
so **every** create / update / delete / stimulus fails without one. The BFF
always sends it, falling back to `ITOP_DEFAULT_COMMENT`.

### 3. `objects` has three different shapes

`core/get` returns:

- a **map** of `"Class::id" → object` for a single-class query
- an **array** of `{ alias → object }` when the OQL selects more than one class
- **`null`** when nothing matched — PHP leaves the property uninitialised

`src/itop/normalize.ts` collapses all three. Getting this wrong means a JOIN
query or an empty result set crashes the caller.

### 4. iTop cannot sort

OQL has no `ORDER BY` production (`core/oql/oql-parser.y`), and `core/get`
hardcodes `DBObjectSet`'s `$aOrderBy` to `[]`
(`restservices.class.inc.php:556`). There is no sort parameter to pass.

It does *order*, though: with no order given, `DBObjectSet` falls back to the
class default (`dbobjectset.class.php:691`), which is `friendlyname` unless the
datamodel declares one — `ref` ascending for tickets. So "the first page" is the
oldest rows, not the newest; the dashboard's recent-incidents list reads the
last page for that reason.

So `?sort=` is implemented **in the BFF**: it fetches the whole matching set
(capped at `SORT_ROW_CAP`, 2000 rows), orders it, and slices the page.
Responses carry `sortedInBff: true` so this is never invisible. Past the cap
you get a `400` telling you to narrow the query rather than a quietly
mis-sorted page.

Unsorted listing uses `limit`/`page` natively and stays cheap.

### 5. The total row count is only in prose

Pagination needs a total, and the only one available is the `"Found: N"` text in
`message`. `DBObjectSet::Count()` builds it with `limit=0`
(`dbobjectset.class.php:808`), so `N` *is* the across-all-pages total. Parsed in
`parseFoundCount`, with a fallback so a format change degrades instead of lying.

### 6. Datetimes have no time zone

iTop stores a DateTime as wall-clock text on its own clock
(`"2026-10-20 14:04:17"`, `timezone` in config-itop.php), with no offset. A
browser elsewhere would read that as its own local time and be hours out.
The BFF knows iTop's zone from `ITOP_TIMEZONE` (default `Europe/Paris`) and
converts at the edges, in `shared/itop-time.ts`:

- **Out:** every DateTime attribute, case-log entry date and stopwatch
  deadline goes to the browser as an exact ISO instant
  (`"2026-10-20T12:04:17.000Z"`): records (`ObjectsService`), tickets,
  the portal, history, the dashboard, the notification send log and the bell.
  Date-only attributes (AttributeDate) are calendar days and stay `YYYY-MM-DD`.
- **In:** a DateTime written or filtered on may be an ISO instant (what the
  frontend sends); it is moved onto iTop's clock. Wall-clock text and bare
  days are read as iTop's own, as before.
- **Days:** the dashboard's ranges, trend buckets and change week are iTop's
  calendar days, whatever zone the BFF host runs in.

Exports (`transfer`) are iTop's own files and keep iTop's wall-clock text.

---

## Schema-driven, and schema corrections

The API surface is generated from `cmdb-schema/cmdb-schema.json`, which covers
the **whole iTop datamodel** — 146 classes (40 CI, 8 ticket, 98 other), not just
the CMDB. This BFF is the frontend's only door to iTop, so a class missing from
that file does not exist as far as any consumer is concerned.
`extract-schema.py` excludes only iTop's own bookkeeping classes (audit trail,
event log, async tasks) and classes that appear as bare forward references
because the module defining them is not installed — `Problem` is one of those
in this instance.

Note the corollary: the compiled datamodel declares attributes that reach into
uninstalled modules (`Incident.parent_problem_id`). iTop's *running* model has
no such attribute and rejects the entire request if it is named in
`output_fields`, so those fields — and any `ExternalField` resolved through one
— are dropped from the automatic field sets.

Every field carries a `ui` category and a `widget`, so a frontend can render
forms generically:

| `ui` | meaning | writable? |
|---|---|---|
| `scalar` | plain editable value | yes |
| `picker` | `ExternalKey` → write the integer id | yes |
| `readonly` | `ExternalField`, computed via a key | **never** |
| `related` | `LinkedSet` — a related-objects tab | no |
| `ignored` | not data at all | no |

**Writes are filtered against this on the way through**
(`src/services/write-validation.ts`). Sending `brand_name` on a `Server` is
rejected with a message naming `brand_id` instead, because iTop computes
`brand_name` from that key.

### Corrections applied at load

`extract-schema.py`'s `ui_category()` only special-cases `ExternalField`,
`ExternalKey` and `LinkedSet*`, so two iTop types fall through to `scalar`
incorrectly. The BFF fixes both on load and reports them:

```bash
curl http://127.0.0.1:4000/api/meta/diagnostics
```

| Class.field | Problem | Corrected to |
|---|---|---|
| `Organization.parent_id`, `Group.parent_id` | `HierarchicalKey` is a foreign key to the same class. As `scalar` a generic form renders a text input and writes a string where an integer id belongs. | `picker` |
| `Organization.overview`, `Team.overview` | `Dashboard` is a rendered view, not stored data, but landed in `writable`. | `ignored` |
| `Organization.deliverymodel_id` → `DeliveryModel`<br>`Document.documenttype_id` → `DocumentType` | Target class absent from the export, so the dropdown has nothing to list. | flagged `targetAvailable: false` |

The first two are worth fixing upstream in `extract-schema.py`. The last two no
longer have an export fix available: the script now exports the whole datamodel,
so a target that is still absent means the iTop module defining it is not
installed. This layer compensates either way, and such fields are kept out of
`output_fields` so they cannot break a query.

---

## API

### Meta

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/meta/classes` | all classes, grouped into `ci` / `abstract` / `lookup` |
| `GET` | `/api/meta/classes/:class` | full field descriptors, lifecycle, writable/readonly split |
| `GET` | `/api/meta/classes/:class/fields/:attcode/options` | picker options, honouring the datamodel filter |
| `GET` | `/api/meta/diagnostics` | schema problems found at load |
| `GET` | `/api/meta/operations` | verbs this iTop build exposes |

### Screen endpoints

Unlike `/api/objects/*` these are not generic: they exist so one screen costs one
request instead of a dozen round trips, and they are where iTop's vocabulary is
translated into the frontend's (`assigned` -> `open`, priority `1` -> `critical`).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/dashboard/overview?range=24h\|7d\|30d\|90d` | KPIs, trend, category split, SLA breakdown, recent incidents, catalogue, change calendar, FAQs |
| `GET` | `/api/nav/counts` | sidebar badge counts for the whole shell |

`myAssignments` is always empty today: the BFF authenticates as a single service
account, so there is no "me" to resolve until the auth module passes a caller
identity down.

### Objects

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/objects/:class` | list; see query params below |
| `GET` | `/api/objects/:class/:id` | one object, `fields=full` by default |
| `POST` | `/api/objects/:class` | create → `201` |
| `PATCH` | `/api/objects/:class/:id` | partial update |
| `DELETE` | `/api/objects/:class/:id` | `?simulate=true` to preview the cascade |
| `POST` | `/api/objects/:class/:id/stimulus` | lifecycle transition |
| `GET` | `/api/objects/:class/:id/links/:attcode` | objects across a `LinkedSet` |
| `POST` | `/api/objects/:class/:id/links/:attcode` | `{ targetId }`: n-n creates the link row, 1-n points the object here; honours `edit_mode` |
| `DELETE` | `/api/objects/:class/:id/links/:attcode/:itemId` | n-n deletes the link row, 1-n clears the key (refused when mandatory) |
| `POST` | `/api/objects/:class/bulk` | `{ action: update\|stimulus\|delete, ids, fields?, stimulus? }`, at most 500 ids; one call per record, per-record outcome |
| `GET` | `/api/objects/:class/export?format=csv\|xlsx\|pdf` | the list's rows (same `view`, `q`, filters), rendered by iTop's `webservices/export-v2.php`; optional `fields` |
| `POST` | `/api/objects/:class/import` | `{ csv, simulate, reconciliationKeys?, separator? }` → iTop's `webservices/import.php`, parsed into counts + per-line status; 10 MB max |
| `POST` | `/api/objects/:class/bulk/delete-plan` | `{ ids }`: the combined deletion plan, nothing deleted |
| `GET` | `/api/objects/:class/:id/history` | change history from `CMDBChangeOp`, grouped per save, newest first |
| `GET` | `/api/objects/:class/:id/related` | impact graph (`relation`, `direction`, `depth`, `redundancy`) |

**List query parameters**

- `page` (default 1), `limit` (default 50, max 500)
- `q` — free-text, `LIKE` across the class's string attributes
- `sort` + `order` — BFF-side, see above
- `fields` — `summary` (list default) · `full` (detail default, excludes link
  sets) · `all` (iTop `*`, includes link sets) · or `name,status,org_id`
- `oql` — raw OQL escape hatch
- `view` — a navigation view id (`GET /api/meta/navigation`); the BFF supplies
  its OQL
- **any other parameter is an exact-match filter**, e.g.
  `/api/objects/Server?status=production&org_id=3`

- `criteria` — advanced search, a JSON array of `{ field, op, value?, value2?, values? }`
  (`contains`, `starts_with`, `equals`, `in`, `gt`, `between`, `empty`, …). Each is
  checked against the field's kind and turned into escaped OQL in
  `src/platform/objects/criteria.ts`; `GET /api/meta/classes/:class` publishes
  the operators each field takes under `criteria`. Exports accept it too.

`q` and filters **narrow** a `view` or `oql` rather than being ignored: the
base query is nested as `… AND id IN (<view OQL>)`, the same form iTop's own
tests use, so views written with aliases or JOINs need no rewriting.

`DELETE` on an id that matches nothing returns `404`. iTop itself answers
`code 0` with an empty plan in that case, which used to read as a success.

`id` and `friendlyname` are always included.

### Lookups

| Method | Path |
|---|---|
| `GET` | `/api/lookups/:class?q=&limit=` |

### Dependent pickers

Many pickers are constrained by an OQL filter referencing the object being
edited, e.g. `Server.model_id` is
`SELECT Model WHERE brand_id=:this->brand_id AND type=:this->finalclass`.
Those `:this->` placeholders cannot be evaluated server-side — during a create
there is no object yet. Pass the form's current values as query params:

```
GET /api/meta/classes/Server/fields/model_id/options?brand_id=7
→ { "options": [...], "dependsOn": ["brand_id"], "filter": "SELECT Model WHERE …" }
```

The simple `a = :this->x AND b = :this->y` form is translated. Anything with a
`JOIN` or `BELOW` — `Server.location_id` is the notable one — is **not**
mistranslated; the response sets `filterIgnored: true` so the UI can keep the
dropdown disabled rather than show wrong options.

### Errors

```json
{ "error": { "code": "bad_request", "message": "…", "itopCode": 100, "details": [] } }
```

---

## Security notes

- **OQL injection.** The REST API has no bind parameters — `key` is handed
  straight to `DBObjectSearch::FromOQL`. Every literal goes through
  `quoteString` in `src/itop/oql.ts`, which escapes `\` then `'` to match the
  lexer exactly (`oql-lexer.plex:172` allows only `\\` and `\'`, reversed by
  `stripslashes` at `oql-parser.y:199`). Every class and attribute code is
  checked against the compiled schema. `LIKE` terms get a second escaping layer
  so a search for `50%` does not match everything.
- **Credentials** live only in this service. Browsers never see iTop.
- **No retry on writes.** `rest.php` has already run `DBInsert` by the time a
  response could be lost, so retrying would duplicate objects. Only `core/get`,
  `core/get_related`, `core/check_credentials` and `list_operations` retry.
- **CORS** is an explicit allowlist (`CORS_ORIGINS`).
- 500 responses never include an internal message or stack.

---

## Layout

Organised **by module**, mirroring `frontend/src/features/`. A domain is one
folder on each side with the same name, so "where does this go?" has the same
answer in both repos.

```
backend/
├── src/
│   ├── index.ts              bootstrap, graceful shutdown
│   ├── app.ts                Fastify factory (injectable, for tests)
│   ├── services.ts           dependency wiring — builds every service once
│   │
│   ├── config/               ⚙️  configuration, no business logic
│   │   ├── env.ts            the ONLY reader of process.env / .env
│   │   └── modules.ts        ⭐ THE MODULE REGISTRY — see "Adding a module"
│   │
│   ├── core/                 framework-level helpers, domain-agnostic
│   │   ├── errors.ts         AppError + status mapping
│   │   ├── cors.ts
│   │   └── validate.ts       zod request parsing
│   │
│   ├── itop/                 🔌 the ONLY code that talks to iTop
│   │   ├── client.ts         transport: form POST, timeout, selective retry
│   │   ├── codes.ts          RestResult codes → HTTP
│   │   ├── normalize.ts      the three `objects` shapes, "Found: N"
│   │   ├── oql.ts            OQL builder + escaping
│   │   └── types.ts          wire types
│   │
│   ├── schema/               the iTop datamodel (146 classes)
│   │   ├── load.ts           loader + corrections
│   │   └── types.ts          Field / ClassInfo
│   │
│   ├── platform/             generic capability — always on, not a domain
│   │   ├── health/           liveness + upstream reachability
│   │   ├── meta/             schema & module introspection
│   │   ├── objects/          generic CRUD over ANY iTop class
│   │   └── lookups/          picker options, dependent filters
│   │
│   ├── modules/              ⭐ one folder per business domain
│   │   └── dashboard/
│   │       ├── dashboard.routes.ts    HTTP: validation, status codes
│   │       ├── dashboard.service.ts   business logic — decisions live here
│   │       └── index.ts               public API — the ONLY importable file
│   │
│   └── shared/               services two or more modules need
│       ├── relations.service.ts       impact graph
│       └── write-validation.ts        the readonly/writable guard
│
├── test/                     176 tests, no network required
└── scripts/
    ├── smoke.ts              live check against a real iTop
    └── pull-schema.mjs       vendor a schema snapshot for deployment
```

### Rules of the road

1. **Dependency direction:** `app → modules → platform → itop/schema → core`.
   `core/` and `itop/` must never import from `modules/`.
2. **Modules don't reach into each other.** Import from `modules/x/index.ts`
   only. If two modules need the same thing, it moves to `shared/`.
3. **Only `itop/` speaks iTop.** OQL, `auth_pwd`, RestResult codes and the
   `Class::id` key format stop there. A module sees DTOs, never iTop internals.
4. **Routes validate, services decide.** A `.routes.ts` file parses input and
   maps errors to status codes; it contains no business rules.
5. **DTOs are ours, not iTop's.** `status: "in_progress"`, never iTop's
   `assigned`/`ev_assign`. The mapping happens in the module's service, so the
   frontend never learns an iTop concept.
6. **`config/env.ts` is the only file that reads `process.env`.**

## Adding a module

`src/config/modules.ts` is the single source of truth for which business
modules this API exposes. `app.ts` builds the server from that list and names
no module itself.

**A module is registered only once it is built** — the same rule the frontend
registry follows. No endpoints that return 501, no stub routes. If it answers,
it works. A domain is done when it exists on *both* sides.

1. Create `src/modules/<module>/`:

   | File | Holds |
   | ---- | ----- |
   | `<module>.routes.ts` | HTTP layer — validation, status codes |
   | `<module>.service.ts` | business logic — the only place that decides |
   | `<module>.schemas.ts` | zod schemas for request/response |
   | `<module>.types.ts` | DTOs the frontend mirrors |
   | `index.ts` | public API — the ONLY file others may import |

2. Add one entry to `modules`:

   ```ts
   {
     id: "incidents",                       // matches the frontend module id
     basePath: "/api/incidents",
     description: "Unplanned interruptions to a service.",
     register: registerIncidentRoutes,
   }
   ```

Nothing else changes. The routes go live and `GET /api/meta/modules` reports
the module, so the frontend can confirm both sides agree it exists instead of
finding out via a 404.

`src/modules/dashboard` is the reference implementation — copy its shape.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | watch mode |
| `npm run build` / `npm start` | compile to `dist/`, run it |
| `npm test` | 176 tests, no iTop needed |
| `npm run typecheck` | `tsc --noEmit` over src + tests + scripts |
| `npm run smoke` | live read-only check (`-- --write` for full CRUD) |
| `npm run schema:pull` | vendor `cmdb-schema.json` into `schema/` |
| `npm run tenants -- <command>` | list / set / enable / disable / remove tenants; `seed-test` for a local iTop |
| `npm run e2e:tenancy` | live cross-tenant leak test (BFF on :4010 with `TENANCY=on`, after `seed-test`) |
| `npm run e2e:problems` | live problem management: root cause, known error, trends (BFF on :4050; `E2E_LOGIN`, `E2E_PASSWORD`). Creates and deletes its own records |

## Known limitations

- **Sorting** is capped at 2000 rows (upstream cannot sort at all).
- **No lifecycle anywhere.** `extract-schema.py` reports `lifecycles: none` for
  every exported class, so `POST /stimulus` returns `400` for all of them today.
  The code path is complete and will work once a class with a lifecycle (a
  Ticket subclass) is exported.
- **Link classes outside the schema.** 27 `lnk*` classes plus `Ticket` and
  `User` are not in the export, so `/links/:attcode` falls back to iTop's `*`
  field list for them.
- **Writes are not transactional.** iTop exposes no batch verb; each call is
  independent.
- iTop itself should not be reachable by users: publish only the BFF and the
  frontend, so the console cannot be opened even by someone who knows its address.
