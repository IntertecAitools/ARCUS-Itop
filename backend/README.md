# ARCUS Helpdesk — Backend (BFF)

Backend-for-Frontend that sits between the ARCUS UI (`../frontend`) and iTop.

```
 Browser (ARCUS UI)  ──HTTPS/JSON──▶  ARCUS BFF  ──REST/JSON──▶  iTop  (/webservices/rest.php)
                                        │
                                        ├─ auth / sessions
                                        ├─ clean, UI-shaped DTOs
                                        └─ caching, validation, aggregation
```

**Why a BFF:** the browser never sees iTop credentials, OQL, iTop class names or
lifecycle stimuli. The BFF exposes a stable, branded API; iTop can be upgraded or
customised without touching the frontend.

> Status: **not started.** The frontend is being built first against MSW mocks.
> The API contract in `contracts/` is the agreement between both sides.

## Tech stack (proposed)

| Concern       | Choice                                  |
| ------------- | --------------------------------------- |
| Runtime       | Node.js 22 LTS + TypeScript             |
| HTTP server   | Fastify                                 |
| Validation    | Zod (shared shapes with frontend types) |
| API contract  | OpenAPI 3.1 (`contracts/openapi.yaml`)  |
| Cache         | In-memory → Redis later                 |
| Logging       | Pino                                    |
| Tests         | Vitest + Supertest                      |

## Folder structure

```
backend/
├── contracts/                  # ⭐ OpenAPI spec — source of truth for FE ↔ BFF
├── docs/                       # Architecture notes, iTop field mappings, ADRs
├── scripts/                    # Dev scripts (seed iTop, generate types from OpenAPI …)
├── tests/
│   ├── unit/                   # Mappers, services, utils
│   ├── integration/            # Routes against a mocked / real iTop
│   └── fixtures/
│       └── itop/               # Recorded iTop REST responses
└── src/
    ├── server.ts               # Starts the HTTP server
    ├── app.ts                  # Builds the app: plugins, middleware, module routes
    │
    ├── config/                 # env.ts (validated env vars), constants
    ├── middleware/             # auth, error-handler, request-id, rate-limit, cors, logging
    ├── common/
    │   ├── errors/             # AppError, NotFound, Forbidden, ItopError → HTTP mapping
    │   ├── pagination/         # Cursor/offset helpers (iTop uses limit + page)
    │   └── utils/
    ├── cache/                  # Cache abstraction (lookups: services, teams, orgs …)
    ├── jobs/                   # Background jobs (SLA polling, notification fan-out)
    │
    ├── integrations/
    │   ├── itop/               # ⭐ The ONLY code that knows about iTop
    │   │   ├── itop.client.ts  #   REST wrapper: core/get, core/create, core/update,
    │   │   │                   #   core/apply_stimulus, core/get_related, core/check_credentials
    │   │   ├── oql/            #   Safe OQL query builders (no string concatenation of user input)
    │   │   ├── mappers/        #   iTop objects ⇄ ARCUS DTOs (status, priority, case log …)
    │   │   └── types/          #   iTop class/attribute typings (see ../../cmdb-schema)
    │   ├── auth/               # SSO / OIDC / LDAP provider adapters
    │   └── storage/            # Attachment handling
    │
    └── modules/                # One folder per business domain (mirrors frontend/features)
        ├── auth/               # login, logout, me, refresh
        ├── dashboard/          # KPI aggregates
        ├── tickets/            # Cross-type: my tickets, case log, timeline, stimuli
        ├── user-requests/      # UserRequest
        ├── incidents/          # Incident
        ├── problems/           # Problem
        ├── changes/            # Change
        ├── service-catalog/    # Service, ServiceSubcategory
        ├── knowledge-base/     # FAQ, KnownError
        ├── cmdb/               # FunctionalCI lookup
        ├── contacts/           # Person, Team, Organization
        ├── sla/                # SLA, SLT
        ├── attachments/        # Upload / download
        ├── notifications/
        ├── search/
        └── reports/
```

### Inside every module

```
modules/incidents/
├── incidents.routes.ts       # HTTP routes + OpenAPI schema refs
├── incidents.controller.ts   # Parse request → call service → shape response
├── incidents.service.ts      # Business logic; calls integrations/itop
├── incidents.schema.ts       # Zod request/response schemas
├── incidents.mapper.ts       # Module-specific DTO mapping (if not in itop/mappers)
└── incidents.types.ts
```

## Rules of the road

1. **Only `integrations/itop` imports the iTop client.** Modules call services; services call integrations.
2. **Never forward raw iTop payloads** to the client — always map to ARCUS DTOs.
3. **Never build OQL from raw user input** — use `oql/` builders with escaping / allow-lists.
4. **iTop credentials stay server-side** (`.env`, secret store). Use a dedicated iTop REST
   user with the *REST Services User* profile and least privilege.
5. **Contract first:** change `contracts/openapi.yaml` → update frontend MSW mocks → implement.

## Local iTop

iTop runs from `../docker` on `http://localhost:8080`. REST endpoint:
`http://localhost:8080/webservices/rest.php?version=1.3`.
