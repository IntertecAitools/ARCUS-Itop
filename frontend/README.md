# ARCUS Helpdesk — Frontend

Branded ITSM / Helpdesk UI. iTop is the system of record; this app **never talks to
iTop directly**. It calls the ARCUS BFF (`../backend`), which hides iTop's API and data model.

Until the BFF exists, every API call is served by **MSW mocks** (`src/mocks`), so the UI
can be built end to end now and switched to the real BFF by changing one env var.

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
    ├── types/                  # Shared TS types / API DTOs (mirror backend/contracts)
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
