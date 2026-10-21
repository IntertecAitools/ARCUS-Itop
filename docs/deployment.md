# Deploying to a server

The platform and its own iTop 3.4 run together on one server, from
`docker/docker-compose.prod.yml`. iTop is a fresh install of this repository's
`iTop/` that starts empty; nobody uses iTop's screens, and all starting data
is entered through the platform. iTop stays the system of record.

```
browser ──HTTPS──> TLS proxy ──> web (nginx :80) ──/api/──> bff (Node :4000) ──> itop (Apache: rest.php, export-v2.php, import.php)
                                   │ static SPA                 │                     │
                                   └ /healthz                   └──── db (MySQL 8.4: itop, arcus_bff) ───┘
                                                       itop-cron: iTop's background jobs    backup: daily dumps
```

| Service | Image | What it does |
| --- | --- | --- |
| **web** | `frontend/Dockerfile` | The Vite build served by nginx (SPA fallback, `immutable` caching for `/assets/`, `no-cache` for `index.html`). Proxies `/api/` to the BFF, so page and API share one origin and the session cookie stays first-party (`SameSite=Lax`, `HttpOnly`). The only service with a published port. |
| **bff** | `backend/Dockerfile` | `node dist/index.js` as the unprivileged `node` user, with the compiled CMDB schema baked in at `/app/cmdb-schema/`. Not published; only `web` reaches it. |
| **itop** | `docker/itop-prod/Dockerfile` | PHP 8.3 + Apache with `iTop/` baked in (no bind mount). Apache answers only `/webservices/rest.php`, `export-v2.php` and `import.php`, the three calls the BFF makes; the console, the portal, `setup/` and `cron.php` over HTTP answer 403. What the installer writes is in volumes: `itop-conf` (`conf/`), `itop-data` (`data/`), `itop-env` (`env-production/`, the compiled data model), `itop-log`. |
| **itop-cron** | same image | Runs `webservices/cron.php` in a loop (it runs for up to 10 minutes, then restarts): SLA/stopwatch thresholds (TTO/TTR escalations), auto-close, queued email, newsroom (the bell), log rotation. As the service account. |
| **db** | `mysql:8.4.6` | iTop's database and the BFF's sessions database, each with a user of its own, created on first start by `docker/mysql-init/01-databases.sh`. Optional: see "Using an existing MySQL". |
| **backup** | `mysql:8.4.6` | Every day at `BACKUP_TIME`: dumps of both databases plus iTop's `conf/`, `data/`, `env-production/`, into `BACKUP_DIR` on the host. |

Networks: `front` (web, bff), `itop` (bff, itop, itop-cron, db, backup;
`internal`: no route out, nothing can be published on it) and `egress` (itop,
itop-cron, backup: outbound only, for SMTP and an external MySQL). iTop has
no published port at all.

Files: `docker/docker-compose.prod.yml`, `docker/prod.env.example` (compose
values and the BFF), `docker/itop.env.example` (iTop, MySQL, backups),
`docker/itop-prod/` (iTop image, Apache rules, `itop-setup`, `itop-cron`),
`docker/mysql-init/`, `docker/backup/`, `docker/docker-compose.prod.itop-admin.yml`
(emergency console), `docker/docker-compose.prod.localtest.yml` (trying it on
a workstation), `backend/Dockerfile`, `frontend/Dockerfile`,
`frontend/nginx/default.conf.template`.

## From nothing to a working platform

### 1. The server

- Linux with Docker Engine and Docker Compose **2.24 or later**
  (`docker compose version`), git, and about 4 GB of RAM and 20 GB of disk.
  (Docker Desktop on Windows works too; that is how this was verified.)
- A DNS name for the app (`helpdesk.example.com`) and a TLS proxy in front of
  port 8088 (IIS/ARR, nginx, Caddy, a load balancer).
- An SMTP account for outgoing mail (Microsoft 365: `smtp.office365.com:587`).
- Outbound access to Docker Hub for the base images, or a mirror.

### 2. The code and the settings

```bash
git clone https://github.com/IntertecAitools/ARCUS-Itop.git /opt/arcus
cd /opt/arcus
cp docker/prod.env.example docker/prod.env
cp docker/itop.env.example docker/itop.env
chmod 600 docker/prod.env docker/itop.env
```

Both files are gitignored. Generate the secrets (each one different):

```bash
openssl rand -base64 48    # SESSION_SECRET
openssl rand -hex 24       # ITOP_PASSWORD, SESSION_DB_PASSWORD, MYSQL_ROOT_PASSWORD, ITOP_DB_PASSWORD
```

At least, before the first start:

| File | Setting | Value |
| --- | --- | --- |
| `prod.env` | `ITOP_PASSWORD` | the service account's password (`itop-setup` creates the account) |
| `prod.env` | `ITOP_TIMEZONE` | the organisation's zone, e.g. `Asia/Kolkata`. iTop is set to it at install and the BFF reads iTop's times in it; decide it once |
| `prod.env` | `SESSION_SECRET`, `SESSION_DB_PASSWORD` | generated |
| `prod.env` | `CORS_ORIGINS`, `APP_BASE_URL` | `https://helpdesk.example.com` |
| `prod.env` | `SMTP_*`, `MAIL_FROM`, `NOTIFICATION_FROM` | the mail account (password resets) |
| `itop.env` | `MYSQL_ROOT_PASSWORD`, `ITOP_DB_PASSWORD` | generated |
| `itop.env` | `ITOP_ADMIN_USER`, `ITOP_ADMIN_PASSWORD` | the first administrator, who signs in to the platform and creates everyone else |
| `itop.env` | `ITOP_SMTP_*`, `ITOP_MAIL_FROM_*` | the mail account (ticket notifications, sent by iTop) |

Leave `ITOP_BASE_URL=http://itop`, `SESSION_DB_HOST=db`, `ITOP_DB_HOST=db` and
`COMPOSE_PROFILES=bundled-db` as they are for the bundled MySQL. A value
containing `$` must be in single quotes. The rest of `prod.env` is explained in
"Production settings checklist" below.

### 3. Build and start

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env up -d --build
```

`--env-file` supplies the compose-level values; the same `prod.env` is the
BFF's environment and `itop.env` is iTop's. (Other file names: set
`ARCUS_ENV_FILE` / `ITOP_ENV_FILE`, relative to `docker/`, in the shell too.)
The first build takes several minutes. MySQL creates both databases on its
first start. `bff` becomes healthy; `web` stays unhealthy until iTop is
installed (its check signs in to iTop as the service account), and
`itop-cron` logs "iTop is not installed yet".

### 4. Install iTop (once)

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env exec -u www-data itop itop-setup
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env restart itop itop-cron
```

`itop-setup` (`docker/itop-prod/itop-setup.sh`), in about five minutes:

1. Runs iTop's unattended install (`setup/unattended-install`) from
   `docker/itop-prod/install.xml.tpl`, filled from `itop.env`: the empty
   database `ITOP_DB_NAME`, the administrator `ITOP_ADMIN_USER`,
   `ITOP_APP_ROOT_URL`, and the same 46 modules as the local install: CMDB,
   ITIL user requests and incidents, service management, changes, problems,
   known errors, FAQ, the portal base. No sample data.
2. Runs `docker/itop-prod/configure.php`, which sets in iTop's
   `config-itop.php` the `timezone` (`ITOP_TIMEZONE`), the SMTP settings
   (`ITOP_SMTP_*`, `email_transport = SMTP`), the sender
   (`ITOP_MAIL_FROM_*`) and queued sending (`email_asynchronous`, delivered by
   `itop-cron`); then creates the service account `ITOP_USER` with
   **Administrator + REST Services User** and gives the administrator
   **REST Services User** too. iTop's REST API cannot give REST Services User
   to an account that lacks it (`backend/README.md`, "iTop accounts the BFF
   needs"), which is why this runs inside the container.

`itop-cron` holds off until `itop-setup` has finished (it writes
`data/arcus-setup.done`; a cron run during the setup can read iTop's caches
half-written), and pauses again whenever `itop-setup` runs.

`itop-setup` is safe to run again: on an installed iTop it only re-applies
step 2, so after changing the time zone, mail settings or `ITOP_PASSWORD`,
run it again and restart `itop itop-cron bff`.

Check:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env ps   # everything healthy (itop-cron has no check)
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env logs --tail 20 itop-cron
```

`web` turns healthy within a minute (or `docker compose … restart web`).

### 5. The TLS proxy

Serve `https://helpdesk.example.com` from `127.0.0.1:8088` (`WEB_BIND`:
`WEB_PORT`). The proxy must **replace** `X-Forwarded-For` with the client
address and set `X-Forwarded-Proto https`; allow request bodies of 33 MB.
nginx:

```nginx
server {
  listen 443 ssl;
  server_name helpdesk.example.com;
  # ssl_certificate ...;
  client_max_body_size 33m;
  location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 120s;
  }
}
```

Nothing for iTop: it is never published.

### 6. First sign-in and the starting data

Open `https://helpdesk.example.com` and sign in as `ITOP_ADMIN_USER`. Then
enter the starting data in the platform, in this order (each step uses the
ones before it). Each type is a list in the sidebar's module groups (named
below), with **New** for one record and **Import** for a CSV file (map its
columns, run it as a simulation first, then for real).

- [ ] **Your organisation.** The install made one placeholder,
      "My Company/Department" (code `SOMECODE`): rename it under Data
      administration → Organizations rather than adding a second one. Add
      customer organisations (departments, client companies) if tickets are
      raised for more than one. With more than one organisation, set
      `ITOP_DEFAULT_ORG_ID` in `prod.env` to the main one's id (the number in
      its record's address), then `up -d bff`: new records need an
      organisation and the BFF will not guess among several.
- [ ] **The administrator's own contact.** The install linked
      `ITOP_ADMIN_USER` to a person called "My first name My last name": put
      the real name and email on it (Contacts), so notifications reach them.
- [ ] **Locations** (optional), Configuration management → Locations.
- [ ] **Teams** (Contacts, type Team): the support groups tickets are
      assigned to, each in its organisation, with its members.
- [ ] **People** (Contacts, type Person): staff and the people who raise
      tickets, with email addresses (notifications go there). Import is the
      quickest for many.
- [ ] **Delivery models** (Service management): which teams deliver services
      for a customer organisation; set it on the customer organisation.
- [ ] **Accounts** (Administration → **Users**): one per person who signs in.
      Staff get their profiles (Service Desk Agent, Support Agent, …) and REST
      Services User automatically; end users get Portal user. Nobody needs
      iTop's console.
- [ ] **Services**: service families, services and subcategories (the
      catalogue people pick from when raising a request).
- [ ] **SLTs and SLAs**: an SLT is one target (TTO or TTR, a priority, a
      request type, a value in minutes/hours/days); an SLA groups SLTs.
- [ ] **Customer contracts**: for each customer organisation, its services
      with the SLA that applies. Without a contract, a ticket on a service has
      no SLA deadlines and the portal offers no services to that organisation.
- [ ] **CIs** (optional): servers, applications, … under Configuration
      management, imported from CSV where you have inventories.
- [ ] **Notification rules** (Administration → Notifications): who gets an
      email (and a bell notification) when a ticket is created, assigned,
      resolved, or reaches 75%/100% of its SLA.
- [ ] **A test ticket**: raise one on a service with a contract, check its TTO
      and TTR deadlines, assign it, resolve it, and check the emails.

## iTop in this stack

### Locked down

- iTop has no published port and sits on the internal network `itop`; the
  BFF reaches it as `http://itop` (`ITOP_BASE_URL`).
- On top of that, Apache in the iTop image (`docker/itop-prod/apache.conf`)
  serves only `/webservices/rest.php`, `/webservices/export-v2.php` and
  `/webservices/import.php`. Anything else, including iTop's login page,
  `pages/`, the portal, `setup/` and `webservices/cron.php`, answers 403.
- The code in the image belongs to root and is read-only for Apache; only
  `conf/`, `data/`, `env-production/` and `log/` (volumes) are writable.
  `config-itop.php` is read-only (0440).
- `ITOP_APP_ROOT_URL` is iTop's own idea of its address. Links in
  notifications point at the platform (`APP_BASE_URL`), never at iTop, so the
  default (`http://localhost:8089/`, the emergency console below) is fine.

### Emergency access to iTop

Only for repairs nobody can do from the platform. Open the console on the
server's loopback address and reach it through an SSH tunnel:

```bash
docker compose -f docker/docker-compose.prod.yml -f docker/docker-compose.prod.itop-admin.yml --env-file docker/prod.env up -d itop
ssh -L 8089:127.0.0.1:8089 you@server     # from your machine; then open http://localhost:8089/
```

Sign in as `ITOP_ADMIN_USER`. Close it again by starting iTop without the
extra file:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env up -d itop
```

If a tunnel is not possible, publish it through the TLS proxy on a separate
name, restricted to the admins' addresses, and remove the rule afterwards:

```nginx
server {
  listen 443 ssl;
  server_name itop-admin.internal.example.com;
  allow 10.1.2.0/24;    # the admins' network
  deny all;
  location / {
    proxy_pass http://127.0.0.1:8089;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

iTop builds its links and redirects from `app_root_url` (set at install from
`ITOP_APP_ROOT_URL`), so for this address change `app_root_url` in
`config-itop.php` to it (see "Changing iTop's configuration by hand") and
back afterwards.

### Background jobs (itop-cron)

iTop does time-based work only when `cron.php` runs: TTO/TTR thresholds (a
request still New when its TTO passes moves to "Escalated TTO"), auto-close of
resolved tickets, sending queued email, the newsroom (the bell), cleaning up
old data. `itop-cron` runs it continuously as the service account.

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env logs --tail 50 itop-cron
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env exec -u www-data itop-cron \
  sh -c 'php webservices/cron.php --param_file=/tmp/cron.params --status_only=1'
```

The second lists every background task with its last run. Set
`ITOP_CRON_VERBOSE=1` in `itop.env` for a line per task in the logs.

### Changing iTop's configuration by hand

`itop-setup` covers time zone, mail and accounts. For anything else in
`config-itop.php`:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env exec -u www-data itop sh -c \
  'cd conf/production && chmod u+w config-itop.php && vi config-itop.php && chmod u-w config-itop.php && php -l config-itop.php'
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env restart itop itop-cron
```

### Using an existing MySQL

1. On that server, as an administrator (MySQL 8.0+ or MariaDB 10.6+):

   ```sql
   CREATE DATABASE itop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'itop'@'%' IDENTIFIED BY '…';
   GRANT ALL PRIVILEGES ON itop.* TO 'itop'@'%';
   CREATE DATABASE arcus_bff CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'arcus_bff'@'%' IDENTIFIED BY '…';
   GRANT ALL PRIVILEGES ON arcus_bff.* TO 'arcus_bff'@'%';
   ```

   `max_allowed_packet` of at least 64M (attachments are stored in iTop's
   database).
2. `prod.env`: `COMPOSE_PROFILES=` (empty: no `db` service),
   `SESSION_DB_HOST` = that server. `itop.env`: `ITOP_DB_HOST` (and
   `ITOP_DB_PORT`) = that server; `MYSQL_ROOT_PASSWORD` is not used. A MySQL on
   the Docker host itself is `host.docker.internal`.
3. The backup job still works (it dumps with those same accounts).

## Backups

The `backup` service writes one folder per day, at `BACKUP_TIME` (container
clock, UTC unless `TZ` is set in `itop.env`), into `BACKUP_DIR` (`prod.env`,
default `backups/` at the repository root), and deletes folders older than
`BACKUP_KEEP_DAYS` (14):

```
backups/20261021T020000Z/
  itop.sql.gz         iTop's database: every ticket, CI, contact, account, attachment
  arcus_bff.sql.gz    the sessions database (losing it only signs people out)
  itop-files.tar.gz   iTop's conf/ (config-itop.php: passwords, the encryption key), data/, env-production/
```

The folder holds passwords (`config-itop.php`) and every record: keep it
readable by root only (it is created 0700) and **copy it off the server**
(the restore needs `itop.env` / `prod.env` too; keep them in your password
manager). A backup now:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env run --rm backup backup
```

The dumps are consistent (`--single-transaction`) and taken while everything
runs.

### Restore

Onto the same server, or a new one set up with steps 1–3 above (same
`prod.env` and `itop.env`, no `itop-setup`):

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env stop itop itop-cron bff web
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env run --rm backup restore 20261021T020000Z
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env up -d
```

`restore` drops and reloads both databases and replaces iTop's `conf/`,
`data/` and `env-production/` with the backup's. Without an argument it lists
the backups. Everyone has to sign in again only if the sessions database was
not restored or `SESSION_SECRET` differs.

## Health checks

| Check | Where | Means |
| --- | --- | --- |
| `GET /health` on the BFF | `bff` container health check | Process up, schema loaded. Does not touch iTop. |
| `GET /health/upstream` on the BFF | `web` container health check (`wget http://bff:4000/health/upstream`) | The BFF reached iTop and the service account signed in. 503 with `unauthorized` = wrong `ITOP_USER`/`ITOP_PASSWORD` or missing REST Services User (re-run `itop-setup`); `unreachable` = iTop down. |
| `GET /healthz` on web | `web` container health check | nginx is serving. |
| `rest.php` answers | `itop` container health check | Apache and PHP are up (not whether iTop is installed). |
| `mysqladmin ping` | `db` container health check | MySQL accepts connections. |

`docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env ps`
shows them; `web` unhealthy while `bff` is healthy means iTop is down or
refuses the service account (`docker compose … logs bff`). The BFF's health
endpoints are not proxied to the internet; point an external monitor at the
server and run `docker compose … exec web wget -qO- http://bff:4000/health/upstream`.

## Updating

```bash
git pull
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env run --rm backup backup
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env up -d --build
```

Sessions live in MySQL, so a restart signs nobody out (unless
`SESSION_SECRET` changed). A new frontend is picked up on the next page load
because `index.html` is never cached.

When the update changes `iTop/` (a new iTop version, modules added) the
compiled data model in the `itop-env` volume is out of date. Take a backup,
then upgrade iTop's install:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env exec -u www-data itop itop-setup --upgrade
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env restart itop itop-cron
```

When iTop's data model changes, also refresh the schema
(`cmdb-schema/refresh-from-source.py`, see the main README) and rebuild the
BFF image: the schema is part of it. Base images are pinned
(`node:24.14.1-alpine3.23`, `nginx:1.28.0-alpine`, `php:8.3-apache`,
`mysql:8.4.6`); override with `--build-arg NODE_IMAGE=…` / `NGINX_IMAGE=…` /
`PHP_IMAGE=…` and `MYSQL_IMAGE=…` in `prod.env` when updating them. Building
the images on their own (all from the repository root except the frontend):

```bash
docker build -f backend/Dockerfile -t arcus-bff .
docker build -f docker/itop-prod/Dockerfile -t arcus-itop .
docker build -t arcus-web frontend
```

## Trying it on a workstation

`docker/docker-compose.prod.localtest.yml` adds a Mailpit test mailbox that
iTop and the BFF send to. Use a project name and ports of its own so it does
not meet the development stack (`:8080`, `:4000`, `:5173`):

```bash
docker compose -p arcus-try -f docker/docker-compose.prod.yml -f docker/docker-compose.prod.localtest.yml --env-file docker/prod.local.env up -d --build
```

with, in the test `prod.env`: `WEB_PORT=8098`, `COOKIE_SECURE=false`,
`CORS_ORIGINS` / `APP_BASE_URL` `http://127.0.0.1:8098`, `SMTP_HOST=mailpit`,
`SMTP_PORT=1025`, `SMTP_REQUIRE_TLS=false`; in the test `itop.env`:
`ITOP_SMTP_HOST=mailpit`, `ITOP_SMTP_PORT=1025`, `ITOP_SMTP_ENCRYPTION=none`.
The inbox is on `http://127.0.0.1:8026`. `down -v` removes everything.

## Production settings checklist

Every BFF setting is read in `backend/src/config/env.ts`; the development
defaults are in `backend/.env.example`. In production, set these in
`docker/prod.env`; iTop's in `docker/itop.env`.

### Must change from the development defaults

- [ ] **HTTPS everywhere the browser goes.** Terminate TLS in front of `web`,
      redirect HTTP to HTTPS.
- [ ] **`COOKIE_SECURE=true`.** The session cookie is then sent only over
      HTTPS. Leave it `false` only for a plain-HTTP test on localhost.
- [ ] **`TRUST_PROXY=true`.** Set by the compose file: the BFF is always behind
      nginx. Client addresses (used to rate-limit password-reset requests) are
      then read from `X-Forwarded-For`. Your TLS proxy must **replace**
      `X-Forwarded-For` with the client address (nginx:
      `proxy_set_header X-Forwarded-For $remote_addr;`), not pass through what
      the client sent, or a client can choose its own address. It should also
      set `X-Forwarded-Proto https`.
- [ ] **`SESSION_STORE=mysql`** with:
  - `SESSION_SECRET`: at least 32 characters, `openssl rand -base64 48`. It
    encrypts each session (which carries the user's iTop password). Keep it
    out of the database's reach and out of git; changing it signs everyone
    out.
  - `SESSION_DB_HOST` (`db`, the bundled MySQL), `SESSION_DB_PORT` (3306),
    `SESSION_DB_USER`, `SESSION_DB_PASSWORD`, `SESSION_DB_NAME` (default
    `arcus_bff`). A database of its own, **not iTop's**; the bundled MySQL
    creates it and its user on first start (with an existing MySQL, create
    them first, see above). The BFF creates its tables (`bff_sessions`,
    `bff_password_resets`) on start and refuses to start if the database
    cannot be reached.
  - `memory` would sign everyone out on every restart and allows only one BFF
    instance.
- [ ] **`APP_BASE_URL`**: the public address of the app, e.g.
      `https://helpdesk.example.com` (no trailing slash). Password-reset links
      and links in notification emails point here, never at iTop. Required
      once `SMTP_HOST` is set.
- [ ] **`CORS_ORIGINS`**: the same public origin
      (`https://helpdesk.example.com`), comma-separated if there are several.
      Writes (anything but GET/HEAD) carrying any other `Origin` are refused.
      Do not use `*` in production.
- [ ] **`ITOP_BASE_URL`**: `http://itop`, the iTop service on the internal
      network (no trailing slash; the BFF adds `/webservices/rest.php`).
- [ ] **`ITOP_TIMEZONE`**: the organisation's time zone. `itop-setup` writes
      it into iTop's `config-itop.php`; iTop stores datetimes as local text in
      that zone, and the BFF converts them with the same value. Choose it
      before the first install; changing it later shifts every stored time.

### The iTop service account (`ITOP_USER`, `ITOP_PASSWORD`)

- [ ] A dedicated iTop account (not a person's) with **Administrator** and
      **REST Services User** profiles. `itop-setup` creates it from these two
      values, and `itop-cron` runs iTop's background jobs as it. See
      `backend/README.md`, "iTop accounts the BFF needs".
- [ ] `secure_rest_services` is on by default in iTop, so without REST
      Services User every call fails (iTop code 1, the BFF answers 403;
      `/health/upstream` says `unauthorized`).
- [ ] Staff accounts get REST Services User automatically when created or
      saved from **Users** in the app.
- [ ] Use a long random password and rotate it like any service credential:
      change `ITOP_PASSWORD`, run `itop-setup` again, then
      `up -d bff itop itop-cron`.

### Mail

Two different senders; configure both.

- [ ] **The BFF** (password resets), in `prod.env`. Off until `SMTP_HOST` is set.
  - `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS, 465 implicit TLS),
    `SMTP_SECURE` (defaults from the port), `SMTP_USER`, `SMTP_PASSWORD`.
  - `SMTP_REQUIRE_TLS` stays at its default `true`; `false` is only for a
    local test mailbox.
  - `MAIL_FROM`: `"Label <address>"`, required with `SMTP_HOST`.
  - `PASSWORD_RESET_MINUTES` (default 30, 5–1440).
- [ ] **`NOTIFICATION_FROM`**: the sender written on notification rules made
      in the app (`"Label <address>"`; defaults to `MAIL_FROM`).
- [ ] **iTop** (ticket notifications), in `itop.env`, applied by `itop-setup`:
      `ITOP_SMTP_HOST`, `ITOP_SMTP_PORT`, `ITOP_SMTP_ENCRYPTION` (`tls`,
      `ssl`, `none`), `ITOP_SMTP_USER`, `ITOP_SMTP_PASSWORD`,
      `ITOP_MAIL_FROM_ADDRESS`, `ITOP_MAIL_FROM_LABEL`. Emails are queued and
      sent by `itop-cron` within a minute. Providers that require OAuth
      (`email_transport = SMTP_OAuth`) need a hand edit, see
      "Changing iTop's configuration by hand".

### Optional, with sensible defaults

| Setting | Default | Notes |
| --- | --- | --- |
| `ITOP_REST_VERSION` | `1.4` | Keep 1.4: pagination needs it. |
| `ITOP_TIMEOUT_MS` | `30000` | Per iTop call (1000–600000). nginx waits 120 s. |
| `ITOP_RETRIES` | `2` | Retries for transient upstream failures (0–10). |
| `ITOP_DEFAULT_COMMENT` | `via intertec-backend` | Tracking comment on writes, seen in iTop's history. |
| `ITOP_DEFAULT_ORG_ID` | resolved | Organisation for new records when the UI does not ask. Blank: the service account's organisation, else the only one; refuses to guess among several. |
| `LOOKUP_CACHE_TTL` | `60` | Seconds to cache picker lists; 0 disables. |
| `LOG_LEVEL` | `info` | Logs go to stdout as JSON (`docker compose logs`). Passwords and cookies are redacted. |
| `AUTH_REQUIRED` | `true` | **Never `false` in production.** |
| `SESSION_IDLE_MINUTES` | `60` | 5–1440. |
| `SESSION_MAX_HOURS` | `12` | 1–720. |
| `HOST`, `PORT` | `0.0.0.0`, `4000` | Fixed by the image and compose file. |
| `CMDB_SCHEMA_PATH`, `CMDB_NAVIGATION_PATH`, `CMDB_DASHBOARDS_PATH` | `/app/cmdb-schema/…` | Set by the image. Override only to mount a newer schema without rebuilding. |
| `BACKUP_DIR` (prod.env) | `../backups` | Host folder for backups, relative to `docker/`. |
| `BACKUP_TIME`, `BACKUP_KEEP_DAYS` (itop.env) | `02:00`, `14` | Daily backup time (container clock) and retention. |
| `ITOP_APP_ROOT_URL` (itop.env) | `http://localhost:8089/` | iTop's own address; only the emergency console uses it. |
| `MYSQL_IMAGE` (prod.env) | `mysql:8.4.6` | The bundled MySQL and the backup job. |

Frontend values are compiled into the bundle, so they are build arguments
(set in `docker/prod.env`, applied on `--build`): `VITE_APP_NAME`,
`VITE_PLATFORM_NAME`, `VITE_DEFAULT_LOCALE`. `VITE_BFF_URL` is `/api` (same
origin) and `VITE_API_MODE` is `live`; do not change them for this layout.

### Network and host

- [ ] Only the TLS proxy is reachable from users; `web` binds to `127.0.0.1`
      by default (`WEB_BIND`). The BFF, iTop and MySQL are never published.
- [ ] The server can reach the SMTP server (iTop and the BFF both send).
- [ ] Uploads: attachments up to 32 MB and imports up to 10 MB pass through
      nginx (`client_max_body_size 33m`); raise the TLS proxy's limit to
      match.
- [ ] `BACKUP_DIR` is copied off the server every day.

## After the first start

1. `docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env ps`:
   everything `healthy`.
2. Open the public address, sign in as the administrator, open the dashboard.
3. With mail on, use "Forgot password?" once and check the link points at
   `APP_BASE_URL`.
4. Enter the starting data (step 6) and create the remaining accounts from
   **Users**; nobody needs iTop's console.
5. Take a backup (`run --rm backup backup`) and copy it off the server.
