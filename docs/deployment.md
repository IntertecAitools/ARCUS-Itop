# Deploying to a server

The platform is two containers in front of an iTop 3.4 install you already
have. iTop and its MySQL are not part of this deployment; nobody uses iTop
directly, but it stays the system of record.

```
browser ──HTTPS──> TLS proxy ──> web (nginx :80) ──/api/──> bff (Node :4000) ──> iTop /webservices/rest.php
                                   │ static SPA                 │
                                   └ /healthz                   └── MySQL: sessions (database of its own)
```

- **web** (`frontend/Dockerfile`): the Vite build served by nginx, with SPA
  fallback, `immutable` caching for the hashed files in `/assets/` and
  `no-cache` for `index.html`. It proxies `/api/` to the BFF, so the page and
  the API share one origin and the session cookie stays first-party
  (`SameSite=Lax`, `HttpOnly`).
- **bff** (`backend/Dockerfile`): `node dist/index.js` as the unprivileged
  `node` user, with the compiled CMDB schema (`cmdb-schema/*.json`) baked in at
  `/app/cmdb-schema/`. It is not published; only `web` reaches it.

Files: `backend/Dockerfile`, `frontend/Dockerfile`,
`frontend/nginx/default.conf.template`, `docker/docker-compose.prod.yml`,
`docker/prod.env.example`.

## Run it

```bash
cp docker/prod.env.example docker/prod.env
```

Fill in `docker/prod.env` (gitignored) using the checklist below, then:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env up -d --build
```

`--env-file` supplies the compose-level values (`WEB_BIND`, `WEB_PORT`,
`ARCUS_VERSION`, `VITE_*`); the same file is the BFF's environment
(`env_file`). To use a file with another name, set `ARCUS_ENV_FILE` (relative
to `docker/`) in the shell as well as passing `--env-file`.

The app is then on `http://127.0.0.1:8088` (`WEB_BIND`:`WEB_PORT`). Put your
TLS proxy (IIS/ARR, nginx, Caddy, a load balancer) in front of that address
and serve it as `https://helpdesk.example.com`.

Building the images on their own:

```bash
docker build -f backend/Dockerfile -t arcus-bff .
docker build -t arcus-web frontend
```

The BFF image builds from the **repository root** (it needs `cmdb-schema/`);
the frontend from `frontend/`. Base images are pinned (`node:24.14.1-alpine3.23`,
`nginx:1.28.0-alpine`); override with `--build-arg NODE_IMAGE=…` /
`NGINX_IMAGE=…` when updating them.

### Health checks

| Check | Where | Means |
| --- | --- | --- |
| `GET /health` on the BFF | `bff` container health check | Process up, schema loaded. Does not touch iTop. |
| `GET /health/upstream` on the BFF | `web` container health check (`wget http://bff:4000/health/upstream`) | The BFF reached iTop and the service account signed in. 503 with `unauthorized` = wrong `ITOP_USER`/`ITOP_PASSWORD` or missing REST Services User; `unreachable` = network/URL. |
| `GET /healthz` on web | `web` container health check | nginx is serving. |

`docker compose -f docker/docker-compose.prod.yml ps` shows both; `web`
unhealthy while `bff` is healthy means iTop is down or refuses the service
account (`docker compose … logs bff`). The BFF's health endpoints are not
proxied to the internet; point an external monitor at the server and run
`docker compose … exec web wget -qO- http://bff:4000/health/upstream`, or
publish them yourself on an internal address.

### Updating

Pull the new code, then `up -d --build` again. Sessions live in MySQL, so a
restart signs nobody out (unless `SESSION_SECRET` changed). A new frontend is
picked up on the next page load because `index.html` is never cached.

When iTop's data model changes (new modules, fields), refresh the schema first
(`cmdb-schema/refresh-from-source.py`, see the main README) and rebuild the
BFF image: the schema is part of the image.

## Production settings checklist

Every BFF setting is read in `backend/src/config/env.ts`; the
development defaults are in `backend/.env.example`. In production, set these
in `docker/prod.env`.

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
  - `SESSION_DB_HOST`, `SESSION_DB_PORT` (3306), `SESSION_DB_USER`,
    `SESSION_DB_PASSWORD`, `SESSION_DB_NAME` (default `arcus_bff`). Use a
    database of its own, **not iTop's**, and create it first
    (`CREATE DATABASE arcus_bff;` plus a user with rights on it only). The
    BFF creates its tables (`bff_sessions`, `bff_password_resets`) on start
    and refuses to start if the database cannot be reached.
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
- [ ] **`ITOP_BASE_URL`**: iTop's address as seen from the BFF container (no
      trailing slash; the BFF adds `/webservices/rest.php`). An internal URL is
      fine and preferable; iTop does not need to be reachable from the
      internet. `host.docker.internal` works for an iTop on the same host.
- [ ] **`ITOP_TIMEZONE`**: the `timezone` value in iTop's
      `conf/production/config-itop.php` (iTop's default `Europe/Paris`). iTop
      stores datetimes as local text in that zone; a wrong value shifts every
      time the app shows.

### The iTop service account (`ITOP_USER`, `ITOP_PASSWORD`)

- [ ] A dedicated iTop account (not a person's) with **Administrator** and
      **REST Services User** profiles. See `backend/README.md`, "iTop accounts
      the BFF needs". REST Services User must be given **by hand once per
      iTop install**; the API cannot add it to an account that lacks it.
- [ ] `secure_rest_services` is on by default in iTop, so without REST
      Services User every call fails (iTop code 1, the BFF answers 403;
      `/health/upstream` says `unauthorized`).
- [ ] Staff accounts get REST Services User automatically when created or
      saved from **Users** in the app; accounts made earlier in iTop need one
      save there.
- [ ] Use a long random password and rotate it like any service credential.

### Mail

Two different senders; configure both.

- [ ] **The BFF** (password resets). Off until `SMTP_HOST` is set.
  - `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS, 465 implicit TLS),
    `SMTP_SECURE` (defaults from the port), `SMTP_USER`, `SMTP_PASSWORD`.
  - `SMTP_REQUIRE_TLS` stays at its default `true`; `false` is only for a
    local test mailbox.
  - `MAIL_FROM`: `"Label <address>"`, required with `SMTP_HOST`.
  - `PASSWORD_RESET_MINUTES` (default 30, 5–1440).
- [ ] **`NOTIFICATION_FROM`**: the sender written on notification rules made
      in the app (`"Label <address>"`; defaults to `MAIL_FROM`).
- [ ] **iTop's own mail settings** — iTop sends the notification emails, so
      set in its `config-itop.php` (read-only file: `chmod u+w`, edit,
      `chmod u-w`, check with `php -l`): `email_transport` (`SMTP`, or
      `SMTP_OAuth` for providers that require it), `email_transport_smtp.host`,
      `.port`, `.encryption` (`tls`/`ssl`), `.username`, `.password`,
      `email_default_sender_address`, `email_default_sender_label`. See
      `backend/README.md`, "Switching to the real mail server".
- [ ] iTop must also be able to run its background tasks (`cron.php`) so
      queued notifications go out.

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

Frontend values are compiled into the bundle, so they are build arguments
(set in `docker/prod.env`, applied on `--build`): `VITE_APP_NAME`,
`VITE_PLATFORM_NAME`, `VITE_DEFAULT_LOCALE`. `VITE_BFF_URL` is `/api` (same
origin) and `VITE_API_MODE` is `live`; do not change them for this layout.

### Network and host

- [ ] Only the TLS proxy is reachable from users; `web` binds to `127.0.0.1`
      by default (`WEB_BIND`). The BFF is never published.
- [ ] The BFF container can reach iTop (`ITOP_BASE_URL`), the session MySQL,
      and the SMTP server. On Linux, `host.docker.internal` is mapped by the
      compose file (`host-gateway`).
- [ ] iTop's own `display_errors = Off` in PHP (otherwise PHP 8.2+ deprecation
      notices corrupt REST responses; see `backend/README.md`).
- [ ] Back up the session database with everything else; it holds only
      encrypted sessions and reset tokens, so losing it just signs people out.
- [ ] Uploads: attachments up to 32 MB and imports up to 10 MB pass through
      nginx (`client_max_body_size 33m`); raise the TLS proxy's limit to
      match.

## After the first start

1. `docker compose -f docker/docker-compose.prod.yml ps`: both `healthy`.
2. Open the public address, sign in as an administrator, open the dashboard.
3. With mail on, use "Forgot password?" once and check the link points at
   `APP_BASE_URL`.
4. Create the remaining accounts from **Users**; nobody needs iTop's console.
