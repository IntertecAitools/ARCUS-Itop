# Intertec Helpdesk — Frontend

Branded ITSM / Helpdesk UI. iTop is the system of record; this app **never talks to
iTop directly**. It calls the BFF in `../backend`, which hides iTop's API and data model.

The BFF already exists and runs on `http://localhost:4000` — see `../backend/README.md`
for its API. Until a screen is wired to it, API calls are served by **MSW mocks**
(`src/mocks`); switch to the real BFF by changing one env var (`VITE_API_MODE=live`).

## Tech stack

| Concern            | Choice                                   |
| ------------------ | ---------------------------------------- |
| Framework / build  | React 19 + TypeScript + Vite             |
| Styling            | Tailwind CSS 4 + design tokens (`src/theme`) |
| Routing            | React Router                             |
| Server state       | TanStack Query                           |
| Client/UI state    | Zustand (`src/stores`)                   |
| Forms + validation | React Hook Form + Zod                    |
| Tables             | TanStack Table                           |
| i18n               | i18next                                  |
| API mocking        | MSW (Mock Service Worker)                |
| Unit tests         | Vitest + React Testing Library           |
| E2E tests          | Playwright                               |
| Charts             | Recharts (palette in `src/theme/charts.ts`) |
| Icons              | lucide-react                             |

## Getting started

```bash
npm install
cp .env.example .env     # defaults to VITE_API_MODE=mock — no BFF needed
npm run dev              # http://localhost:5173
```

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Vite dev server with MSW mocks                       |
| `npm run build`     | Typecheck + production build                         |
| `npm run typecheck` | Types only                                           |
| `npm test`          | Vitest unit tests (`src/**/*.test.ts(x)`)            |
| `npm run e2e`       | Browser journeys against the mock API (what CI runs) |
| `npm run e2e:live`  | The same journeys, plus live-only ones, against BFF + iTop |

## Data comes from the backend

`.env` ships as `VITE_API_MODE=live`: every screen reads real iTop data through
the BFF. **There is no mock data in the running app.**

```
browser ──> frontend :5173 ──> backend :4000 ──> iTop :8080
```

So you need both up:

```bash
cd docker && docker compose up -d     # iTop on :8080
cd backend && npm run dev             # BFF  on :4000
```

| Endpoint                             | Used by                     |
| ------------------------------------ | --------------------------- |
| `GET /api/dashboard/overview?range=` | the whole dashboard, in one request |
| `GET /api/nav/counts`                | sidebar badge counts        |
| `GET /api/incidents`                 | the incident queue          |
| `GET /api/incidents/:id`             | incident detail             |
| `GET /api/incidents/options`         | form pickers, in one request |
| `POST /api/incidents`                | raise an incident           |
| `PATCH /api/incidents/:id`           | edit fields                 |
| `POST /api/incidents/:id/transitions`| assign / hold / resolve / close / reopen |
| `POST /api/incidents/:id/log`        | post a public update        |

MSW handlers still exist in `src/mocks` for working offline — set
`VITE_API_MODE=mock` if the backend is unavailable. They are opt-in, and nothing
uses them by default.

> **iTop is slow.** A single REST call takes **6–8 seconds** on this instance,
> so a page that makes several feels sluggish. That is upstream, not the UI;
> the BFF already batches what it can (the dashboard is one request, not twelve).

## Tests

```bash
npm test             # Vitest units — no servers needed
npm run e2e          # browser journeys, mock API — no servers needed (CI runs this)
npm run e2e:live     # the same journeys against the BFF + local iTop + Mailpit
```

### Browser journeys (Playwright, `tests/journeys/`)

The main user journeys, end to end in Chromium:

| Spec | Journey |
| --- | --- |
| `staff.spec.ts` | sign in (back to the page asked for) → dashboard; My Assignments → open an incident → resolve it |
| `records.spec.ts` | records → a class → advanced search → open a record |
| `notifications.spec.ts` | notification rules list → create a rule |
| `bell.spec.ts` | the bell: unread count, open an item (marks it read) |
| `portal.spec.ts` | end user signs in → raises a request → finds it in their list → comments |
| `forgot-password.spec.ts` | forgot password from sign-in, neutral answer |
| `live.spec.ts` | live only: a portal request resolved by staff emails the caller (read from Mailpit), who then sees it resolved; a reset email's link sets a new password that signs in |

`E2E_TARGET` picks the stack (`tests/journeys/support/target.ts`). Specs
tagged `@mock` run only against the mocks, `@live` only live; the rest run
in both.

**Mock (`npm run e2e`, the default).** Playwright builds the app with
`VITE_API_MODE=mock` into `dist-e2e/` and serves it on :5674; every API call
is answered by the MSW handlers in `src/mocks`. The build points the API at a
port nothing listens on, and a test fails if the page makes a call the mocks
do not answer, or throws. Each test starts signed out with the seeded mock
data (`sessionStorage` keys `arcus.mock.*`, see `src/mocks/storage.ts`); any
login works, and a login starting with `portal` is the end user. When a
journey needs data the mocks do not serve yet, extend the handlers rather
than stubbing in the spec. CI runs this on every pull request (job **E2E**;
the HTML report and traces are uploaded when it fails). Locally it reuses a
server already on :5674, so after changing app code stop it or let
Playwright start its own.

**Live (`npm run e2e:live`).** Needs the local iTop and Mailpit
(`docker/docker-compose.local.yml`, see `../backend/README.md`, "Local iTop")
and a BFF of its own, on ports no other session uses:

```bash
cd backend
PORT=4600 CORS_ORIGINS=http://localhost:5673 APP_BASE_URL=http://localhost:5673 MFA_REQUIRED=off npm run dev
cd frontend && npm run e2e:live     # starts the frontend on :5673 itself
```

A global setup checks the BFF, iTop and Mailpit, signs in as the staff account
(`E2E_STAFF_LOGIN`/`E2E_STAFF_PASSWORD`, default: the admin of the
unattended install, `docker/itop-install-params.xml`) and keeps a portal
account for the end-user journeys (`E2E_PORTAL_LOGIN`, default `e2e.portal`,
email `e2e.portal@example.test`), created on the first run and given a new
random password on every run. Other ports: `E2E_BFF_URL`,
`E2E_FRONTEND_URL`, `E2E_MAILPIT_URL`.

Each live run leaves its tickets in iTop (titled with the run's stamp, like
`E2E lx3k9a1234 …`, or `Printer jams on floor 3 …`) and deletes the
notification rule it creates. Tests run one at a time: they share one iTop.

Reports: `playwright-report/<target>/` locally (`npx playwright show-report
playwright-report/mock`), traces of failed tests in `test-results/`.

## Adding a module

The sidebar, the route table and the Ctrl-K palette are all **generated from
`src/config/modules.ts`**. There is no second list to keep in sync, so a module
lands in one edit and nobody's branch blocks anyone else's.

**A module is registered only once it is built.** Nothing is listed ahead of
time: no dead nav items, no routes that lead to an apology, no search results
for screens that don't exist. If you can see it in the UI, it works. Today that
means the registry holds exactly one entry — `dashboard`.

To add one:

1. Write the screens under `src/features/<feature>/pages/`.
2. Export them from `src/features/<feature>/index.ts`.
3. Add an entry to `modules` with a lazy `component`:

   ```ts
   const incidents: ModuleDefinition = {
     id: 'incidents',
     label: 'Incidents',
     path: 'incidents',
     icon: LifeBuoy,
     group: 'operations',
     description: 'Unplanned interruptions to a service.',
     badgeKey: 'openIncidents', // optional sidebar count
     component: lazy(() =>
       import('@/features/incidents').then((m) => ({ default: m.IncidentListPage })),
     ),
   };
   ```

Nav item, route, breadcrumb and palette entry light up on their own. Detail
screens go in the same entry's `children` array.

### Cross-links follow the registry too

Links between modules go through `isModuleRegistered()`, so a dashboard card's
"View all →", a ticket reference, or a "Create request" button **renders only
when its target exists**. The dashboard therefore never offers a dead link, and
each of those links appears by itself the moment the module behind it lands —
no edit to the dashboard required.

`src/features/dashboard` is the reference implementation — it exercises every
shared piece (KPI tiles, both chart forms, the data table, tabs, empty and
loading states). Copy its composition pattern rather than inventing a new one.

## Theme

Tokens live in `src/styles/globals.css` and are the **only** place raw colour
values appear. They surface as Tailwind utilities (`bg-surface`,
`text-ink-muted`, `border-line`, `shadow-card`, `rounded-card`) and — for code
that must hand a colour to a library — as `var()` references via `src/theme`.

Light and dark are two *selected* sets of steps, not an automatic inversion.
Switching theme is a single `data-theme` flip on `<html>`; nothing re-renders.

The eight chart series colours are assigned in a **fixed order and never
cycled**. That order is the colour-blind-safety mechanism: candidate orderings
were enumerated and only one clearing every adjacent-pair gate in both modes was
kept. If you re-order, re-step or add a hue, re-run the palette validator — see
the header comment in `src/theme/charts.ts`. A ninth series is never a generated
hue; fold the tail into "Other", or use small multiples.

Status roles (good / warning / serious / critical) are **reserved** — never
reused as a series colour, and never the only signal: every status chip carries
a dot or icon plus a text label.

Full rules: `docs/ui-guidelines.md`.

## Users / app areas

| Area       | Route prefix | Who                      | Purpose                                       |
| ---------- | ------------ | ------------------------ | --------------------------------------------- |
| **Portal** | `/portal`    | End users / requesters   | Raise requests, track my tickets, browse KB   |
| **Agent**  | `/agent`     | Support agents, managers | Queues, work tickets, dashboards, reports     |
| **Auth**   | `/login` …   | Everyone                 | Login, SSO callback, forgot password          |

Each area has its own layout in `src/app/layouts`.

## Folder structure

```
frontend/
├── public/                     # Static files served as-is (favicon, robots.txt)
│   └── brand/                  # Logos used by index.html / emails / PWA manifest
├── docs/                       # Frontend docs: UI guidelines, screen specs, decisions
├── tests/
│   ├── e2e/                    # Playwright end-to-end specs
│   └── fixtures/               # Shared E2E test data
└── src/
    ├── main.tsx                # Entry point (starts MSW in mock mode, mounts <App/>)
    ├── App.tsx                 # Root component -> providers + router
    │
    ├── app/                    # App shell — wiring only, no business logic
    │   ├── providers/          # QueryClient, Theme, i18n, Auth, Toast providers
    │   ├── router/             # Route table (lazy-loads feature pages)
    │   │   └── guards/         # RequireAuth, RequireRole (portal vs agent)
    │   └── layouts/            # AgentLayout, PortalLayout, AuthLayout
    │
    ├── assets/                 # Imported assets (bundled by Vite)
    │   ├── brand/              # Intertec logo variants, wordmark
    │   ├── fonts/
    │   ├── icons/              # Custom SVG icons
    │   ├── images/
    │   └── illustrations/      # Empty states, error pages
    │
    ├── theme/                  # Design tokens: colors, typography, spacing, radii, shadows
    ├── styles/                 # globals.css, Tailwind entry, base resets
    │
    ├── components/             # Shared, feature-agnostic UI (no API calls in here!)
    │   ├── ui/                 # Primitives: Button, Input, Select, Checkbox, Badge, Avatar, Tabs, Tooltip
    │   ├── layout/             # Sidebar, Topbar, PageHeader, Breadcrumbs, Container
    │   ├── data-display/       # DataTable, StatusPill, PriorityBadge, Timeline, KpiCard, Charts
    │   ├── forms/              # FormField, DatePicker, RichTextEditor, FileUpload, ComboBox
    │   ├── feedback/           # Toast, Alert, Skeleton, Spinner, EmptyState, ErrorBoundary
    │   └── overlays/           # Modal, Drawer, ConfirmDialog, Popover, CommandPalette
    │
    ├── features/               # ⭐ One folder per business domain (see below)
    │   ├── auth/               # Login, SSO, session, current user
    │   ├── dashboard/          # Agent home, KPIs, my queue summary
    │   ├── tickets/            # Shared ticket building blocks (case log, timeline,
    │   │                       #   attachments, assign/resolve/close actions, SLA timer)
    │   ├── user-requests/      # iTop UserRequest  — service requests
    │   ├── incidents/          # iTop Incident
    │   ├── problems/           # iTop Problem
    │   ├── changes/            # iTop Change (Normal / Routine / Emergency)
    │   ├── service-catalog/    # Services & subcategories (request catalogue for portal)
    │   ├── knowledge-base/     # FAQ / Known errors
    │   ├── cmdb/               # CI lookup & linking to tickets (read-only here)
    │   ├── contacts/           # Persons, teams, organizations (caller / agent pickers)
    │   ├── sla/                # SLA / SLT display, breach indicators
    │   ├── notifications/      # In-app notification centre
    │   ├── search/             # Global search (Ctrl+K)
    │   ├── reports/            # Reports & exports
    │   └── settings/           # User profile, preferences, theme, language
    │
    ├── lib/                    # Framework-level helpers (no React components)
    │   ├── api-client/         # fetch wrapper for the BFF: base URL, auth header,
    │   │                       #   error normalisation, retries
    │   ├── query/              # QueryClient config + query-key factory
    │   ├── i18n/               # i18next setup
    │   │   └── locales/        # en.json, ...
    │   └── utils/              # date, format, cn(), debounce …
    │
    ├── hooks/                  # Global hooks: useDebounce, useMediaQuery, useHotkeys
    ├── stores/                 # Zustand stores: ui (sidebar, theme), session
    ├── types/                  # Shared TS types / API DTOs (mirror ../backend responses)
    ├── config/                 # env.ts, constants, navigation menu, feature flags
    ├── mocks/                  # MSW — fake BFF until the real one is ready
    │   ├── handlers/           # One handler file per feature (tickets.ts, auth.ts …)
    │   └── fixtures/           # Realistic sample data
    └── test/                   # Vitest setup, render helpers, test utils
```

### Inside every feature

Every folder in `src/features/<feature>/` follows the same layout:

```
features/incidents/
├── api/            # Query & mutation hooks calling the BFF
│                   #   incidents.api.ts  -> getIncidents(), createIncident() …
│                   #   useIncidents.ts, useIncident.ts, useCreateIncident.ts
├── components/     # Components used only by this feature (IncidentForm, IncidentRow)
├── hooks/          # Feature-only hooks (useIncidentFilters …)
├── pages/          # Route-level screens (IncidentListPage, IncidentDetailPage, NewIncidentPage)
├── types.ts        # Feature types
├── schemas.ts      # Zod schemas for forms
└── index.ts        # Public API — the ONLY file other features may import from
```

## Rules of the road

1. **Dependency direction:** `app → features → components / lib / hooks / types`.
   `components/` and `lib/` must never import from `features/`.
2. **Features don't reach into each other.** Import from `features/x/index.ts` only.
   If two features need the same thing, move it to `components/` or `features/tickets/`.
3. **No iTop concepts in the UI.** Components use our DTOs (`status: "in_progress"`),
   not iTop internals (`status: "assigned"`, `org_id`, OQL). Mapping happens in the BFF.
4. **No hardcoded colours / brand values** — use tokens from `src/theme`.
5. **All network calls go through `lib/api-client`** and are wrapped in TanStack Query hooks
   inside the feature's `api/` folder.
6. **Every new endpoint gets an MSW handler** in `src/mocks/handlers` so the UI works without the BFF.

## Naming conventions

| Thing             | Convention               | Example                    |
| ----------------- | ------------------------ | -------------------------- |
| Components        | `PascalCase.tsx`         | `TicketTimeline.tsx`       |
| Hooks             | `useCamelCase.ts`        | `useTicketFilters.ts`      |
| Pages             | `<Name>Page.tsx`         | `IncidentDetailPage.tsx`   |
| API modules       | `<feature>.api.ts`       | `incidents.api.ts`         |
| Tests             | next to file, `.test.tsx`| `TicketTimeline.test.tsx`  |
| Folders           | `kebab-case`             | `user-requests/`           |

## Environment

See `.env.example`. Key switch:

- `VITE_API_MODE=mock` → MSW intercepts all calls (default for now)
- `VITE_API_MODE=live` → calls the BFF at `VITE_BFF_URL`

## Suggested ownership (split for the team)

| Track                              | Folders                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| Design system & shell              | `theme/`, `styles/`, `components/`, `app/layouts/`               |
| Auth & platform                    | `features/auth`, `lib/`, `app/providers`, `app/router`, `mocks/` |
| Ticketing core                     | `features/tickets`, `incidents`, `user-requests`                 |
| Portal                             | `features/service-catalog`, `knowledge-base`, portal pages       |
| ITIL extended                      | `features/problems`, `changes`, `cmdb`                           |
| Insights                           | `features/dashboard`, `reports`, `sla`                           |
