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
- Not yet here: iTop's in-app ("newsroom") notifications.


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
5. Email goes to **Mailpit**, a test mailbox started with iTop by the same
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
