# BFF contract: Problem Management

The frontend never calls iTop directly. Every request goes to the **BFF**, which translates it into
iTop REST/JSON operations. Until the BFF exists, **MSW plays the BFF** (`src/mocks/handlers/*`), and these
handlers are the reference implementation of this contract.

- Base URL: `NEXT_PUBLIC_BFF_URL` (bff mode) or `/api/bff` (mock mode)
- Auth: `Authorization: Bearer <token>` from `POST /auth/login`
- Field names are **iTop attribute codes** (`org_id`, `servicesubcategory_id`, `private_log` …)
- Dates are ISO 8601 strings
- Errors: any non-2xx returns `{ "code": string, "message": string }`. `lib/api-client` throws an `ApiError`
  and the global toast shows `message`

| Status | `code` examples | When |
|---|---|---|
| 400 | `missing_field`, `invalid_value`, `read_only`, `invalid_stimulus`, `unknown_field` | Validation / lifecycle violations |
| 401 | `unauthorized`, `invalid_credentials` | No or expired session (the app signs out) |
| 403 | `forbidden` | Profile may not write |
| 404 | `not_found` | Object does not exist (pages show a not-found state) |

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{ login, password }` | `{ token, user: CurrentUser }` |
| POST | `/auth/logout` | – | 204 |
| GET | `/auth/me` | – | `CurrentUser` |

`CurrentUser = { id, login, name, roleCode, profiles[], personId, orgId }`. Write access requires the
iTop profile `Administrator` or `Problem Manager`.

## Problems

| Method | Path | iTop operation | Notes |
|---|---|---|---|
| GET | `/problems` | `core/get` | Query: `status, priority, impact, urgency` (comma lists), `orgId, teamId, agentId, serviceId, q, from, to` (YYYY-MM-DD on `start_date`), `sort` (`-start_date`, `priority` …), `page, pageSize`. Returns `{ items: ProblemSummary[], total, page, pageSize }`. `status=none` matches nothing. |
| GET | `/problems/stats?range=7d\|30d\|90d` | `core/get` (aggregated) | `{ range, kpis: { open, unassigned, resolvedThisWeek, knownErrors } (each { value, previous }), series: [{ date, created, resolved }], byPriority: [{ priority, count }], topServices: [{ service_id, service_name, count }] }`. `previous` = same measure one week earlier. |
| GET | `/problems/:id` | `core/get` | Full `Problem` incl. `private_log`, `functionalcis_list`, `contacts_list`, `knownerrors_list`, `related_incident_list`, `related_request_list`, `related_change_ref`, `*_name` fields |
| POST | `/problems` | `core/create` | `{ org_id, caller_id, title, description, service_id, servicesubcategory_id, product, impact, urgency, functionalcis_list: [{ functionalci_id }], contacts_list: [{ contact_id }], related_incident_ids: [] }` → 201 `Problem`. Rejects `status` and `priority`. |
| PATCH | `/problems/:id` | `core/update` | Only attributes writable in the current state (see the UI spec). Rejects `status` (use a transition) and `priority` (computed). |
| GET | `/problems/:id/transitions` | lifecycle introspection | `[{ stimulus, target, required: Field[], prompted: Field[] }]` for the **current** state only |
| POST | `/problems/:id/transitions/:stimulus` | `core/apply_stimulus` | `{ fields: { team_id, agent_id, … }, note? }` → `Problem`. `note` is added to `private_log`. |
| POST | `/problems/:id/log` | `core/update` with `private_log` `add_item` | `{ message }` (HTML) → `Problem`. Read-only once closed. |
| GET / POST / DELETE | `/problems/:id/incidents[/:incidentId]` | `core/update` of `Incident.parent_problem_id` | POST body `{ id }`; DELETE clears `parent_problem_id` |
| GET / POST / DELETE | `/problems/:id/requests[/:requestId]` | `core/update` of `UserRequest.parent_problem_id` | same |
| GET / POST / DELETE | `/problems/:id/cis[/:ciId]` | `functionalcis_list` (lnkFunctionalCIToTicket) | POST adds with `impact_code=manual` |
| GET / POST / DELETE | `/problems/:id/contacts[/:contactId]` | `contacts_list` (lnkContactToTicket) | POST adds with `role_code=manual` |
| PUT | `/problems/:id/change` | `core/update` of `related_change_id` | `{ changeId: string \| null }`. Only Changes that are **not closed**. |
| GET | `/problems/:id/attachments` | `core/get Attachment` (`item_class=Problem`) | `[{ id, filename, mimetype, size, creation_date }]` |
| GET | `/problems/:id/attachments/:attId` | `core/get Attachment` | `{ filename, mimetype, data (base64) }` |
| POST | `/problems/:id/attachments` | `core/create Attachment` | `{ filename, mimetype, data }` → 201 metadata |
| DELETE | `/problems/:id/attachments/:attId` | `core/delete Attachment` | 204 |

### Lifecycle enforced by the BFF (iTop `itop-problem-mgmt`)

```
new      ── ev_assign ──►   assigned   requires team_id + agent_id (agent must be a team member)
assigned ── ev_reassign ──► assigned   team_id + agent_id
assigned ── ev_resolve ──►  resolved   requires service_id; prompts servicesubcategory_id, product
resolved ── ev_reassign ──► assigned
resolved ── ev_close ──►    closed
```

Dates set automatically: `assignment_date` (assign / reassign), `resolution_date` (resolve), `close_date` (close).
`priority` = matrix(impact, urgency), recomputed on every write.

## Known errors

| Method | Path | Notes |
|---|---|---|
| GET | `/known-errors?q=&domain=&problemId=&page=&pageSize=` | `{ items: KnownErrorSummary[], total, page, pageSize }`; `q` searches name, error code, symptom, vendor, model, version |
| GET | `/known-errors/:id` | `KnownError` incl. `ci_list` (`functionalci_id`, `functionalci_name`, `reason`) and `document_list` |
| POST | `/known-errors` | `KnownErrorInput`: `name`*, `org_id`*, `symptom`*, `problem_id`, `root_cause`, `workaround`, `solution`, `error_code`, `domain` (Network/Server/Application/Desktop), `vendor`, `model`, `version`, `ci_list: [{ functionalci_id, reason }]` |
| PATCH | `/known-errors/:id` | same body |

## Lookups (`?q=` typeahead → `LookupOption[]`)

`LookupOption = { id, label, hint? }`, max 50 results.

| Path | Extra params | Notes |
|---|---|---|
| `/orgs` | – | |
| `/persons` | `orgId` (callers), `teamId` (agents) | hint = email |
| `/teams` | – | |
| `/services` | `orgId` | services the org subscribes to |
| `/services/:id/subcategories` | – | |
| `/cis` | – | FunctionalCI; hint = class |
| `/changes` | `open=true` | label = ref; hint = title · class · status |
| `/incidents` | – | label = `ref · title`; hint = status · org |
| `/user-requests` | – | same |
