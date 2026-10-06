# Problems UI spec

Scope: the **existing** features of iTop Problem Management (`itop-problem-mgmt`) and the Known Errors it
links to (`itop-knownerror-mgmt`). No statuses, fields or workflows beyond iTop's.

## Screens

| Route | Page (`features/*/pages`) | Contents |
|---|---|---|
| `/problems` | `ProblemsDashboardPage` | Header (Welcome back, / Problem Management / date / + Create ▾) · KPI cards: Open (new + assigned), Unassigned (new), Resolved This Week, Known Errors, each with a trend vs the previous week · Problems Trend (created vs resolved, 7/30/90 days) · Problems by Priority donut · Recent Problems · My Problems · Top Affected Services |
| `/problems/list` | `ProblemListPage` | Tabs All · Open · Unassigned · My Problems · Resolved · Closed. Filters: search (debounced), status, priority, impact, urgency, org, service, team, agent (scoped to team), created from/to. Sort, pagination, column chooser (persisted), CSV export (up to 1,000 rows). **All list state is in the URL.** |
| `/problems/new` | `ProblemNewPage` | Org*, caller (scoped to org), title*, description* (rich text), service → subcategory, product, impact*, urgency*, live priority preview, CIs, contacts, link incidents. On save, opens the detail page. |
| `/problems/[id]` | `ProblemDetailPage` | Header (ref, title, priority + status pills, org, caller, team/agent, dates) · action buttons for allowed stimuli · lifecycle stepper · tabs (`?tab=`) Details · Activity · Incidents · User Requests · Configuration Items · Contacts · Known Errors · Related Change · Attachments |
| `/knowledge-base/known-errors` | `KnownErrorListPage` | Search, domain filter, paginated table, "New known error" (also opened by `?new=1`) |
| `/knowledge-base/known-errors/[id]` | `KnownErrorDetailPage` | Symptom, root cause, workaround, solution, properties, CIs with reason, documents, link to the problem; edit in place |
| `/dashboard` | `DashboardPage` | Reuses the problem KPI widgets |
| other nav items | `[...slug]` placeholder | "Coming soon" card |

## Field rules (data in `features/problems/schemas.ts → FIELD_RULES`)

| Field | new | assigned | resolved | closed |
|---|---|---|---|---|
| org_id | mandatory | mandatory | read-only | read-only |
| caller_id | optional | optional | read-only | read-only |
| title, description | mandatory | mandatory | read-only | read-only |
| service_id | optional | optional | **mandatory** | read-only |
| servicesubcategory_id, product | optional | optional | optional | read-only |
| impact, urgency | mandatory | mandatory | read-only | read-only |
| team_id, agent_id | hidden | **mandatory** | read-only | read-only |
| related_change_id | optional | optional | optional | read-only |
| priority | read-only (computed) everywhere; never sent | | | |

Dates shown per state: start/last update always; assignment from *assigned*; resolution from *resolved*;
close when *closed*.

## Lifecycle actions

- Buttons come from `GET /problems/:id/transitions`, so only stimuli iTop allows are shown.
- `TransitionDialog` shows **only** that stimulus's required and prompted fields (per-stimulus Zod schema
  from `transitionSchema(stimulus)`) plus an optional note that goes to the case log.
  - Assign / Reassign: team*, agent* (agent scoped to the team)
  - Resolve: service*, subcategory, product
  - Close: note only
- Closed problems are read-only: no edit, link, upload, log or transition actions.

## Priority preview (UI only; iTop computes the real value)

```
impact \ urgency   1  2  3  4
1 Department       1  1  2  4
2 Service          1  2  3  4
3 Person           2  3  3  4
```

## Permissions

`features/auth → hasPermission(user, 'problem:write' | 'knownerror:write')`: iTop profiles
`Administrator` or `Problem Manager`. Users without them see no create, edit, link or transition actions,
and `/problems/new` shows a "no access" state (`RequireRole`).

## Behaviour

- Optimistic updates for Details edits, case log notes and attachment deletes; rolled back on error.
- Every mutation invalidates the problem detail, lists and stats (`qk.problems.*`).
- Errors from the BFF appear as a global toast (`ApiError.message`); 404s render a not-found state.
- Accessibility: WCAG AA colours (critical badge uses `danger-solid`), visible focus rings, ARIA tabs,
  combobox, dialogs with focus trap, skip link, labelled filters.
- Responsive: sidebar 240px ≥ 1280px, icon rail 768–1279px, drawer < 768px.
