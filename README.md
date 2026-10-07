# ARCUS Helpdesk

Our own ITSM / helpdesk product, built on **iTop as the system of record**.

iTop stores the data and owns the datamodel. We never modify it and the browser
never talks to it. Everything users see is ours.

```
browser ──> frontend ──HTTP/JSON──> backend ──form POST──> iTop
             :5173                   :4000                 :8080
```

---

## Repository map

Only two folders contain code we write:

| Folder | What it is | Ours? |
| ------ | ---------- | ----- |
| **`frontend/`** | React 19 + TypeScript + Vite. The entire UI. | ✅ **yes** |
| **`backend/`** | Fastify + TypeScript. The BFF over iTop's REST API. | ✅ **yes** |
| `cmdb-schema/` | Generator that extracts iTop's datamodel to JSON (146 classes). Run it, don't hand-edit the output. | tooling |
| `iTop/` | Vendored upstream iTop. **Never edit.** | ❌ upstream |
| `docker/` | Compose files, php.ini, install params for the iTop container. | infra |
| `weftbase-site/` | Unrelated marketing site. | — |

> **Rule:** all feature development happens in `frontend/` and `backend/`.
> If a change seems to need an edit inside `iTop/`, it belongs in `backend/`
> instead — that is what the BFF is for.

---

## Getting started

Three terminals.

**1. iTop** (the system of record)

```bash
cd docker && docker compose up -d      # http://localhost:8080
```

**2. Backend**

```bash
cd backend
cp .env.example .env        # set ITOP_PASSWORD
npm install
npm run dev                 # http://127.0.0.1:4000
curl http://127.0.0.1:4000/health/upstream   # proves it can reach + auth to iTop
```

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

New to the codebase? Read `backend/README.md` § *"What this layer is actually
for"* first — it explains why the BFF exists at all, and will save you a day of
confusion about iTop's REST API.
