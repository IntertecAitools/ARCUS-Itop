# ARCUS frontend (IRAOPS)

Problem Management UI for ARCUS. **iTop 3.4** is the system of record; the frontend talks only to the
**BFF**, which maps requests to iTop REST/JSON (`core/get`, `core/create`, `core/update`,
`core/apply_stimulus`). Until the BFF exists, **MSW** plays the BFF in the browser.

Stack: React 19 · Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · TanStack Query · Zustand ·
React Hook Form + Zod · i18next · MSW · Recharts · Vitest + Testing Library · Playwright.

## Getting started

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_MODE=mock by default
npm install
npm run dev                  # http://localhost:3000
```

Demo accounts in mock mode:

| Login | Password | Profile |
|---|---|---|
| `admin` | `admin` | Administrator + Problem Manager (full access) |
| `agent` | `agent` | Support Agent (read-only) |

The mock database lives in `localStorage`. Run `resetMockDb()` in the browser console to restore the seed.

| Script | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint, including the architecture rules below |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unit + component + BFF-contract tests against the MSW handlers) |
| `npm run test:e2e` | Playwright on a production build in mock mode (`npx playwright install chromium` once) |

### Switching to the real BFF

```env
NEXT_PUBLIC_API_MODE=bff
NEXT_PUBLIC_BFF_URL=https://bff.example.com/api
```

No code changes. The contract is in [`docs/bff-contract.md`](docs/bff-contract.md).

## Structure

```
src/
├─ main.tsx          client bootstrap: starts MSW when API_MODE=mock
├─ App.tsx           root client component: providers + shell + guards
├─ app/              Next.js App Router root + app shell (wiring only)
│  ├─ providers/     Query · Theme · i18n · Auth
│  ├─ router/        route metadata (layout, permission) + guards/RequireAuth, RequireRole
│  ├─ layouts/       Agent · Auth · Portal
│  └─ **/page.tsx    thin route files that render a feature page
├─ theme/            design tokens (tokens.css → Tailwind @theme) and tone maps
├─ styles/           globals.css (Tailwind entry)
├─ assets/           brand, icons, illustrations
├─ components/       shared UI, no API calls (ui, layout, data-display, forms, feedback, overlays)
├─ lib/              api-client, query (QueryClient + query keys), i18n, utils
├─ hooks/ stores/ types/ config/
├─ mocks/            MSW fake BFF: handlers (one per feature) + fixtures
├─ test/             Vitest setup, render helpers, next/navigation mock
└─ features/<name>/  api/ · components/ · hooks/ · pages/ · types.ts · schemas.ts · index.ts
```

Built features: **problems** (main work), **knowledge-base** (KEDB), plus the minimal pieces Problems
reuses: `tickets` (case log, linked tickets, badges), `cmdb`, `contacts`, `service-catalog`, `changes`,
`incidents`, `user-requests`, `auth`, `dashboard`. Other nav items render one shared placeholder page.

### How Next.js maps onto this structure

- `src/app/` is the App Router root. Folders without `page.tsx` (`providers/`, `router/`, `layouts/`) are not routes.
- Route files are one-liners that render a page exported from a feature's `index.ts`.
- `layout.tsx` renders `<App>`, which waits for MSW (mock mode), then picks the layout and guards from
  `app/router/routes.ts`. Pages render only on the client, so there is no server data and no hydration mismatch.
- Typed path builders live in `config/routes.ts` (re-exported by `app/router`) so features and shared code
  can build links without importing the app shell.

## Rules (enforced by ESLint where possible)

1. **app → features → shared.** Shared layers never import features, mocks or the shell (`import/no-restricted-paths`).
2. **Features import each other only via `index.ts`** (`no-restricted-imports` on `@/features/*/*`).
3. **All API calls go through `lib/api-client`** (`fetch` is banned elsewhere).
4. **Every endpoint has an MSW handler** in `src/mocks/handlers/` with fixtures in `src/mocks/fixtures/`.
5. **No hardcoded colours**: tokens in `theme/tokens.css`, `tone` props in components (hex literals are a lint error).
6. **All UI text goes through i18next** (`lib/i18n/locales/en.json`, one namespace per feature).
7. **Query keys live only in `lib/query/keys.ts`** (`qk.problems.list(filters)` …).
8. Never send `status` or `priority`. Status changes only through stimuli shown by `/transitions`.

More detail: [`docs/problems-ui-spec.md`](docs/problems-ui-spec.md).
