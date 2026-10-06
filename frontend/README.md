# ARCUS Helpdesk — Frontend

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
| `npm run e2e`       | Playwright shell smoke tests against the real build  |

## Live BFF vs mocks

`VITE_API_MODE` picks where data comes from. **`.env` is currently set to
`live`** — the dashboard reads real iTop data through the BFF:

```
browser ──> frontend :5173 ──> backend  :4000 ──> iTop :8080
```

To run it live you need the BFF up (`cd ../backend && npm run dev`) and iTop
reachable. The BFF serves the screen-shaped endpoints this app calls:

| Endpoint                       | Used by                   |
| ------------------------------ | ------------------------- |
| `GET /api/dashboard/overview?range=` | the whole dashboard, in one request |
| `GET /api/nav/counts`          | sidebar badge counts      |

Set `VITE_API_MODE=mock` to work without a BFF; MSW then intercepts everything.
`.env.example` still defaults to `mock` so a fresh clone runs with no backend.

In mock mode the dashboard serves an **empty** dataset — the honest state of an
instance with no tickets, and the state every empty view is designed against.
Each card shows its own empty copy rather than an invented number, and a KPI
with no baseline shows no delta at all (a "0%" delta would read as "unchanged"
when the truth is "nothing to compare against"). For a populated screen to demo
or style against, flip one constant in `src/mocks/handlers/dashboard.ts`:

```ts
const SEEDED = true;
```

The e2e suite always forces `mock`, so tests never depend on a BFF being up or
on whatever happens to be in iTop that day.

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
    │   ├── brand/              # ARCUS logo variants, wordmark
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
