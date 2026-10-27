# Intertec Helpdesk

Our own ITSM / helpdesk product, built on **iTop as the system of record**.

iTop stores the data and owns the datamodel. We never modify it and the browser
never talks to it. Everything users see is ours.

```
browser ──> frontend ──HTTP/JSON──> backend ──form POST──> iTop
             :5173                   :4000                 :8080
```

---

## Repository map

Two folders contain the product's code; `itop-extensions/` holds the small iTop extensions it needs:

| Folder | What it is | Ours? |
| ------ | ---------- | ----- |
| **`frontend/`** | React 19 + TypeScript + Vite. The entire UI. | ✅ **yes** |
| **`backend/`** | Fastify + TypeScript. The BFF over iTop's REST API. | ✅ **yes** |
| `itop-extensions/` | iTop extensions of our own (`arcus-problem-rca`, `arcus-change-cab`), installed into an iTop's `extensions/`. | ✅ yes |
| `cmdb-schema/` | Generator that extracts iTop's datamodel to JSON (146 classes). Run it, don't hand-edit the output. | tooling |
| `iTop/` | Vendored upstream iTop. **Never edit.** | ❌ upstream |
| `docker/` | Compose files, php.ini, install params for the iTop container. | infra |
| `weftbase-site/` | Unrelated marketing site. | — |

> **Rule:** all feature development happens in `frontend/` and `backend/`.
> If a change seems to need an edit inside `iTop/`, it belongs in `backend/`
> instead — that is what the BFF is for.
> The exception is a field iTop's datamodel does not have at all: that is a
> small extension in `itop-extensions/`, never an edit to `iTop/`.

---

## Getting started

Three terminals.

**1. iTop** (the system of record)

```bash
docker build -t itop-dev:php8.3 docker                       # once
docker compose -f docker/docker-compose.local.yml up -d      # http://localhost:8080
```

Use `docker/docker-compose.local.yml`. It serves the repo's `iTop/` copy from a
Docker volume, so pages load in about a second. The first time, also copy the
code into the volume and run iTop's setup: see the comments at the top of that
file and `backend/README.md`, "Local iTop".

> **Don't use `docker/docker-compose.yml` for day-to-day work.** It serves iTop
> straight from a Windows folder (`C:\iTop\iTop`), and Docker reads each file
> across the Windows↔Linux boundary about 100× slower (measured: 120 iTop files
> in 9.7 s vs 0.1 s). Every page then takes tens of seconds to a minute, and the
> BFF times out. Keep it only for editing iTop's source live, which this project
> never does.

**2. Backend**

```bash
cd backend
cp .env.example .env        # set ITOP_PASSWORD
npm install
npm run dev                 # http://127.0.0.1:4000
curl http://127.0.0.1:4000/health/upstream   # proves it can reach + auth to iTop
```

The iTop account in `ITOP_USER` needs the **Administrator** and **REST
Services User** profiles, set once by hand per iTop install; staff accounts
get REST Services User automatically when created from the app. Details:
`backend/README.md`, "iTop accounts the BFF needs".

**3. Frontend**

```bash
cd frontend
cp .env.example .env        # defaults to VITE_API_MODE=mock
npm install
npm run dev                 # http://localhost:5173
```

The frontend runs standalone on MSW mocks, so **you do not need the backend or
iTop to build a screen**. Set `VITE_API_MODE=live` when you want real data.

---

## The architecture in one idea: modules

Both sides are organised **by business domain**, not by technical layer. A
domain is one folder on each side, with the same name:

```
frontend/src/features/incidents/     backend/src/modules/incidents/
├── api/         query hooks         ├── incidents.routes.ts    HTTP layer
├── components/  UI for this domain  ├── incidents.service.ts   business logic
├── pages/       route screens       ├── incidents.schemas.ts   zod
├── types.ts     DTOs        <──────>├── incidents.types.ts     same DTOs
└── index.ts     public API          └── index.ts               public API
```

Each side has a **module registry** that is the single source of truth:

| Side | Registry | Generates |
| ---- | -------- | --------- |
| frontend | `src/config/modules.ts` | sidebar nav, routes, Ctrl-K palette |
| backend | `src/config/modules.ts` | route registration, `GET /api/meta/modules` |

### The rule that matters

> **A module is registered only once it is built.**

Nothing is listed ahead of time — no dead nav items, no routes that lead to an
apology screen, no endpoints that return 501. If you can see it, it works.

This is why adding a module is one edit per side, and why two people can build
two modules without touching the same file twice. It also means
`GET /api/meta/modules` and the frontend sidebar are a live, honest statement of
what the product currently does.

Today both registries hold exactly one entry: `dashboard`.

---

## Adding a module — the whole workflow

Say you're building **Incidents**.

**Backend first** — the frontend needs something to call.

1. `backend/src/modules/incidents/` — routes, service, schemas, types, `index.ts`
2. Add one entry to `backend/src/config/modules.ts`
3. `npm test` — tests live in `backend/test/`

**Then the frontend.**

4. `frontend/src/features/incidents/` — api, components, pages, `index.ts`
5. Add an MSW handler in `frontend/src/mocks/handlers/` so the screen works
   without the backend
6. Add one entry to `frontend/src/config/modules.ts`

The nav item, route, breadcrumbs and palette entry appear on their own. So do
any dashboard cross-links pointing at Incidents — they are hidden until the
module exists, then light up with no edit to the dashboard.

**Keep the DTOs identical on both sides.** `backend/src/modules/<m>/<m>.types.ts`
and `frontend/src/features/<m>/types.ts` describe the same JSON. That pairing is
the contract.

---

## Conventions

| Thing | Convention |
| ----- | ---------- |
| Folders | `kebab-case` (`user-requests/`) |
| Module id | identical on both sides (`incidents`) |
| React components | `PascalCase.tsx` |
| Pages | `<Name>Page.tsx` |
| Backend files | `<module>.routes.ts`, `<module>.service.ts` |
| Tests | frontend beside the file (`.test.tsx`); backend in `test/` |

### Non-negotiables

- **No iTop concepts in the frontend.** No OQL, no `org_id`, no `Class::id`
  keys, no iTop status codes. The BFF translates; the UI speaks our DTOs.
- **No hardcoded colours in the frontend.** Use the design tokens — see
  `frontend/docs/ui-guidelines.md`.
- **`config/env.ts` is the only file that reads env vars** (on both sides).
- **Every new backend endpoint gets an MSW handler** so the UI is never blocked.

---

## Docs

| Where | What |
| ----- | ---- |
| `frontend/README.md` | stack, module registry, theme, folder structure |
| `frontend/docs/ui-guidelines.md` | design system rules — read before building UI |
| `backend/README.md` | API reference, and the five iTop quirks this layer exists to absorb |
| `cmdb-schema/extract-schema.py` | how the datamodel JSON is produced |
| `docs/deployment.md` | Production: the platform and its own iTop from scratch (compose, first install, cron, backups), every setting |

New to the codebase? Read `backend/README.md` § *"What this layer is actually
for"* first — it explains why the BFF exists at all, and will save you a day of
confusion about iTop's REST API.
