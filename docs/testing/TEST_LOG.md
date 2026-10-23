# Test log

Every test run, newest last. Entries are appended automatically by `.claude/hooks/record-test-run.mjs`; narrative notes (what was tested, bugs found) are added by hand under a dated heading.

## Sessions

### 2026-10-23 — Request forms per catalogue item; target date for the requester

Branch `claude/requests-c8e01b`. This worktree's BFF on `:4040` (sessions and request forms in the shared `arcus_bff` database, new table `bff_request_forms`) against the shared local iTop on `:8080`. iTop 3.4 community has no request templates, so form definitions live in the BFF and answers are written into the request's description. The target date is iTop's own time-to-resolve deadline (`ttr_escalation_deadline`, from the SLA that applies).

| What ran | Result | Notes |
| --- | --- | --- |
| Backend `npm run typecheck` | ✅ | |
| Backend `npm test` | ✅ 569 / 569 (582 / 582 after merging main with approvals) | 13 new in `test/request-forms.test.ts`: answer checks (required, number, date, choice; all problems at once), the HTML block (escaping, line breaks, an HTML description kept), service + subcategory merge, definition cleaning, save only for a visible catalogue item, catalogue counts, staff create through `/api/objects/UserRequest` (answers written, refused without a required answer before iTop is called, no form = untouched), target date read and converted from iTop's time zone, target fields asked only where the datamodel has them |
| Live `npm run e2e:requests` | ✅ 16 / 16 | Sets up its own service, subcategory, contract and a 72 h TTR SLA, then: admin saves forms, broken/unknown forms refused, catalogue counts; portal user reads the merged form, cannot read another service's or the staff endpoint, is refused without the required answer, raises a request whose description holds the answers and whose target date is 72 h out (and in the list); a request with no SLA has no target date; an agent's create is refused without the answer and carries it with; emptying a form removes it. Everything it created is deleted again (the portal account `e2e.requests.portal` is kept and reused) |
| Frontend `tsc -p tsconfig.app.json` | ✅ | |
| Frontend `npx vitest run` | ✅ 163 / 163 (170 / 170 after the merge) | includes new `request-forms/lib/fields.test.ts` |
| Playwright mock journeys `request-forms`, `portal` (`E2E_MOCK_URL=http://localhost:5714`) | ✅ 4 / 4 | new `request-forms.spec.ts`: a service's required question blocks submit, answers and the target date show on the request; a service with no form asks nothing; admin adds a question, preview shows it, save |

Bugs found and fixed (before the first commit):

- iTop stores a ticket's description as HTML (`<format>html</format>`), so the first plain-text "Request details" block would have collapsed onto one line in iTop and its emails. The block is now HTML (`<p>`, `<ul><li>`), a plain description is converted with its line breaks, and the portal shows list items as "- " lines. A typed `<Ana>` is not mistaken for HTML (caught by the unit test).
- A broken form definition could reach iTop before being refused (and failed as a 502 when iTop was busy); the definition is now checked first.

Not covered: the live Playwright suite (`npm run e2e:live`) and a manual look at the screens against the live BFF (the browser pane could not register the mock service worker, so the screens were checked through the Playwright mock journeys); `MySqlRequestFormStore` only live, no unit test. The auto-log hook writes to the main checkout's file, so this worktree's runs are listed at the end by hand.

### 2026-10-23 — Approvals (Combodo "Approval process automation"), staff and portal, notifications

Branch `claude/approvals-82e84e`. A separate test iTop for the extension: compose project `arcus-approvals` (`docker/docker-compose.approvals-test.yml`), container `itop-approvals` on `:8093` plus `itop-approvals-cron`, database `itop_approvals` on the Windows MySQL (a copy of `itop_prod`), mail to the shared Mailpit. The shared `itop-local`/`itop_prod` were not touched. This worktree's BFF on `:4030` (its `node_modules` a junction to the main checkout's), Vite on `:5203`.

| What ran | Result | Notes |
| --- | --- | --- |
| Extension install on the test iTop (unattended upgrade) | ✅ after 3 passes | One pass fails (`Unknown class 'TriggerOnApprovalRequest'`) and the schema lags a compile; pass 1 without `combodo-approval-extended`, then the full list twice. Recipe in `backend/README.md`, "Approvals" |
| Backend `npm run typecheck`, `npm test` | ✅ 532 / 532 | New `test/approvals.test.ts` (PHP unserialize incl. the real stored steps; only the caller's approvals; 404 for non-approvers; token with own or substitute passcode; reject needs a comment; 409 on a second answer or a decided approval; iTop's words when not recorded; no passcode in the request view) and `approvalIn` in `test/inbox.test.ts` |
| Frontend `npm run typecheck`, `npx vitest run`, `npm run build` | ✅ 30 files / 166 tests | New: `ApprovalParts.test.tsx` (approve, reject needs a reason, locked while sending, levels and stand-ins, status in words), `RequireAuth.test.ts` (`portalPathFor`); `modules.test.ts` expects the new Approvals nav item |
| Live: `node scripts/e2e-approvals.mjs` (BFF :4030 → iTop :8093 → Mailpit) | ✅ 10 / 10, twice | Portal request → awaiting approval → level 1 (end user) emailed with `APP_BASE_URL/approvals/<id>` (no `approve.php`) → reject without comment 400 → approve → 409 on repeat, 404/403 for others → level 2 (staff) emailed + bell entry → reject with comment → request rejected, requester emailed, portal shows both answers; second request approved at both levels → approved, requester emailed |
| Live UI (built-in browser, :5203) | ✅ | End user follows the staff link `/approvals/2` → lands on `/portal/approvals/2`; reject without a comment is refused in the form; approve with a comment; nav badge clears. Staff: sidebar Approvals, "Decided by me", detail, and the approval card on `/records/UserRequest/35` |
| After merging `origin/main` (multi-tenancy, SSO): backend typecheck + `npm test`, frontend typecheck + vitest, live e2e | ✅ 569 / 569, 166 / 166, 10 / 10 | New in `test/tenancy.test.ts`: an approval is scoped by the request it is about; `approve.php` is let through only for an approval that reads back inside the tenant |
| Mock browser journeys (`npx playwright test`, `E2E_MOCK_URL=http://localhost:5706`, 2 workers) | ✅ 7 / 7 | After the CI fix below |

Bugs found and fixed (in this branch):

- `frontend/.env.local` (pointing the dev server at `:4030`) made 11 AttachmentsPanel tests fail; they pass without it. Not a code bug: the override is local only and not committed.
- "Decided by me" took 19 s on the loaded machine (every iTop call 2.5–5 s that hour, other sessions' stacks busy): its two iTop reads now run in parallel.
- CI "E2E (browser journeys, mock API)" failed on `6b16b06`: the bell journey expects one unread item, and the new mock "approval requested" notification was a second. The mock item now starts read (fixed in the commit after `6b16b06`).
- After the merge with multi-tenancy, approvals would have been refused for tenant users (`ApprovalScheme` unknown to the schema = platform-only; `approve.php` not an allowed script). `ApprovalScheme` is now scoped like history (polymorphic on `obj_class`/`obj_key`), and the tenant guard checks the token's approval before posting.
- iTop's newsroom (the bell) skips accounts without back-office access, so end-user approvers can never get a bell entry from iTop. They get the email and an Approvals badge / home prompt in the portal instead; documented.

The automatic hook (`.claude/hooks/record-test-run.mjs`) did not append entries for this session's runs; the table above is the record.

Not covered: approvals with tenancy switched on live (unit-tested only; the test BFF runs with tenancy off); approval timeouts, reminders and substitutes live (unit-tested only; the test rule has no timeout); a mock Playwright journey for approvals; a screen to manage approval rules (done in iTop's data for now). Test data left on the test iTop: accounts `e2e.requester`, `e2e.approver`, `e2e.manager` (random passwords), rule "E2E approvals", subcategory "E2E needs approval", coverage window "E2E 24x7", "Trial rule"/"24x7", requests R-000033 to R-000038; `e2e.portal`'s password there was changed.
### 2026-10-22 — Multi-tenancy core: tenants, scoping of every iTop call, cross-tenant leak tests

Branch `claude/multi-tenancy-efcab8`. Backend only. This worktree's BFF on `:4010` (`TENANCY=on`, `PLATFORM_LOGINS=admin`, sessions and tenants in its own database `arcus_bff_mt`) against the shared local iTop on `:8080`. Test data added to iTop by `npm run tenants -- seed-test`: organisations `zz-mt-acme` (13) and `zz-mt-globex` (14), each with a person, an agent (`mt.<t>.agent`, Service Desk Agent, limited to its organisation), an administrator (`mt.<t>.admin`), a user request and a server; tenants `mt-acme` (`acme.localhost`) and `mt-globex` (`globex.localhost`).

| What ran | Result | Notes |
| --- | --- | --- |
| Backend `npm run typecheck`, `npm run build` | ✅ | |
| Backend `npm test` | ✅ 556 / 556 | 521 existing unchanged + 35 new in `test/tenancy.test.ts`: scope rules per class, OQL rewriting (unions, aliases, history pinned to one class, refusals), tenant resolution (domain, user, orphan, disabled, platform operator), and leak tests through the real routes over a small simulated iTop with two tenants (list, guessed id, filter/search, update, delete, create into the other org, a key pointing at the other tenant, export, history, impact graph, saved queries, notifications, wrong domain, account organisations) |
| Live `npm run e2e:tenancy` (A→B and B→A, as agent and as administrator) | ✅ 143 / 143 | Lists of UserRequest, Ticket, Server, FunctionalCI, Person, Organization; search; criteria on the other org; organisation picker; GET by guessed id of ticket, server, organisation, person, history, impact graph, link rows; update, transition, simulated delete, bulk update; create in the other org or with the other's person; CSV export; dashboard; saved queries (list, get, run, delete); user list, account by id, giving an account the other org (create and update); signing in and using a session on the other tenant's site; the other ticket unchanged afterwards; platform operator sees both on the platform address and one on a tenant's site |
| Live spot checks as `mt.acme.admin` | ✅ | Audit overview, nav counts, the bell, dashboards list, own history and pickers answer; notification rules refused (403) |

Bugs found and fixed (in this branch, before the first commit):

- iTop rejected the scoped queries with "Ambiguous filter code" as soon as a tenant condition held a subquery: it resolves an unqualified name against the enclosing queries' aliases too. Tenant conditions are now qualified (`UserRequest.org_id`) and every generated subquery has its own alias (`ts_1`); the wrapped query keeps the class's own alias, so the original query's names still resolve. Confirmed against the live iTop for URP_UserOrg, QueryOQL, CMDBChangeOp, link rows and Organization.
- Account link sets (`allowed_org_list`, `profile_list`) are in the published schema without their link class, so their rows went unchecked; they are now mapped, and any other link set the schema does not describe is refused for tenants.

Not covered: the frontend (no screen changes in scope; the UI was not run against `TENANCY=on`); imports by a non-admin tenant agent against the live iTop (unit-tested only); attachments and the end-user portal under a tenant (they go through the same guard, not exercised live); the MySQL tenant store is exercised only live (no unit test of `MySqlTenantStore`). The auto-log hook recorded this worktree's runs into the main checkout's `docs/testing/TEST_LOG.md` (it resolves `CLAUDE_PROJECT_DIR`), so the entries for these runs at the end of this file were added by hand.

### 2026-10-22 — Sidebar active item and groups; iTop dashboards redesigned; dashlet names and dates

Branch `claude/nav-dashboards-polish`. Frontend plus the BFF's dashboard service. This worktree's BFF on `:4900` (its `node_modules` a junction to the main checkout's) against the local iTop on `:8080`, signed in as the local `admin`; Vite on `:5973`. Screenshots from headless Chromium in `docs/design/nav-dashboards/`.

| What ran | Result | Notes |
| --- | --- | --- |
| Frontend `npx vitest run` | ✅ 28 files / 159 tests | New: `navigation/lib/active.test.ts` (one active entry: path + view, list over search, dashboards by id), `itop-dashboards/lib/labels.test.ts` (plurals, date keys) |
| Frontend `npm run typecheck`, `npm run build` | ✅ | |
| Backend `npm run typecheck`, `npm test` | ✅ 521 / 521 | New: an external-key group is named by its friendly name; a day grouping has full dates in order with quiet days filled; class labels on the payload; a bad `tz` is a 400 |
| Mock browser journeys (`npx playwright test`, `E2E_MOCK_URL=http://localhost:5976`) | ✅ 7 / 7 | |
| Live: `/records/Incident?view=Incident:OpenIncidents` | ✅ | Only "Open" is active in the sidebar (was five items) |
| Live: sidebar right after sign-in | ✅ | Every group closed (the dashboard is in none); "Welcome" is a plain link |
| Live: Welcome, Incident overview, Configuration management overview | ✅ | Desktop dark/light, phone, RTL. Tiles with icons, plural labels, muted zeros; section titles; charts two-up with legends |
| Live: Incident overview data | ✅ | "Open incidents by agent" shows the agent's name, "by customer" the organisation's; the per-day chart's axis reads "Oct 19", "Oct 20" |

Bugs found and fixed (in this branch):

- Sidebar: every view of a class lit up at once (NavLink matched the path and ignored `?view=`). Matching is now path + view, at most one entry.
- Sidebar: a group opened whenever the address merely started with one of its entries' paths. Now only the group holding the active entry opens by default; clicks are remembered until the next sign-in or reload.
- Group-by on an external key returned ids ("1"); the BFF now asks iTop for `<key>_friendlyname` and labels groups with it.
- A `day_of_month` grouping returned "19", "20" (and would have merged the same day of different months); keys are now full YYYY-MM-DD dates, counted in the viewer's zone (`?tz=`), sorted by date, quiet days filled.
- The per-day bars could render empty in a screenshot taken during Recharts' entry animation; the animation is off.

Not covered: the live journeys (`npm run e2e:live`); a screen-reader pass; real Arabic text.

### 2026-10-21 — Realistic data volume: 50,000 tickets, timings, fixes

Branch `claude/data-volume-601f54`. A separate iTop: the production stack as its own compose project, `arcus-perf`, with its own MySQL (`itop_perf`) and iTop on 127.0.0.1:8189. The shared `itop-local`, `itop-mailpit` and `itop_prod` were not touched. It was filled through REST by `backend/scripts/perf-seed.mjs`:

- 20 organisations, 2,000 people, 100 teams, 300 services and subcategories;
- 10,000 CIs and 501 accounts;
- 50,000 tickets over 12 months, with case logs;
- 300 bell items.

Loading took ≈ 4 h 50 min. There were two BFFs on that iTop, `main` on :4801 and this branch on :4800, plus the frontend on :5873.

- Full report: `docs/performance.md`.
- Raw numbers: `docs/performance-data/2026-10-21.csv`.
- The case-log counts per class come from an offline replay of the seeded generator, which matches iTop's live counts.

| What ran | Result | Notes |
| --- | --- | --- |
| `perf-seed.mjs`: tiny scale, then full scale (resumed twice: idempotent) | ✅ 0 failures | 50,000 tickets at 2.3–4.5/s; the CPU-bound laptop was shared with other projects |
| `perf-measure.mjs`: 31 calls × 3 runs, before and after, at 12,242 tickets (busy laptop) and at 50,000 (quiet) | ✅ | Before: 90-day dashboard trend 2,000 of 6,132; "recent incidents" a year old; bell showing the oldest 30; portal 3–15 s. After: all correct, portal 0.3–0.4 s, dashboard 1.1 / 2.3 s |
| Full exports: 20,000 requests and 50,000 tickets, CSV | ✅ | 12–17 s; BFF under 250 MB |
| Real imports: 1,000 people, 200 user requests | ✅ | 33.9 s and 26.5 s |
| MySQL slow log (> 0.5 s) during the runs | ✅ | ~55 queries, worst 2 s; no index needed |
| Browser, frontend :5873 → BFF :4800 | ✅ | Dashboard counts and this week's incidents; User Request list, 20,200 rows, newest first |
| Backend typecheck + unit tests | ✅ 499/499, clean | New: `volume.test.ts` (pageFromEnd, newestRows in both orders, parallel listAll, fail-fast sort, overview SLA counts), portal newest page, enum dashlet counts, audit counted in iTop with an unrelated-class fallback, form agents, transfer timeouts and import caps |
| Frontend typecheck + unit tests + build | ✅ 130/130, clean, built | New: `Dashlet.test.tsx` ("Grouped from the first N of M" note). The first full run failed 11 AttachmentsPanel tests only because a local `.env.local` pointed `VITE_BFF_URL` at :4800 (the MSW handlers expect the default); they pass without it |
| Backend build | ✅ | |
| After merging main (saved queries, public look): backend + frontend typecheck and unit tests | ✅ 517/517, 137/137 | |
| nginx template (`nginx -t` in nginx:1.28.0-alpine) | ✅ | New export/import location with 300 s |

Bugs found and fixed (same branch):

- iTop returns each class in its default order. `UserRequest`, `Incident`, `Change` and events come newest first; `Ticket` comes oldest first. Several places read "the last page" for the newest items and got the oldest:
  - the dashboard's recent incidents;
  - the bell list;
  - notifications sent;
  - the portal.

  Fixed with `newestRows()` / `pageFromEnd()`.
- The dashboard's trend, categories and SLA used the first 2,000 incidents of the window. They now read the whole window in parallel pages.
- The SLA flags cost iTop ~3 ms per row, so the split is now counted in iTop.
- A new `Intl.DateTimeFormat` per date cost 1.3 s per 2,000 rows; there is now one formatter per time zone.
- The KPI window was one day longer than the trend's.
- Grouping dashlets read 5,000 rows in sequence and called that the total. Enums are now counted per value; other groupings report the real total and say when they are truncated.
- Audit runs downloaded whole classes. iTop now counts with nested `IN` / `NOT IN`.
- Incident forms offered only the first 200 people as agents. They now list team members, up to 2,000.
- A sorted list over the 2,000-row cap downloaded 2,000 rows before refusing; it now counts first.
- Exports and imports were cut at 120 s while iTop kept importing. They now get 300 s in the BFF and nginx, and imports over 1,000 tickets or 5,000 other rows are refused at the preview step.

Not covered:

- A Linux server. All timings are from a shared Windows laptop; see "Sizing" in `docs/performance.md`.
- Many users at once. Each call was timed alone, with no concurrent-user load test.
- iTop cron, because no SLTs were defined (SLA flags were all zero).
- Excel and PDF exports of 50,000 rows.
- The test-run hook records into the main checkout's log (see the side-session notes), so these runs are recorded here by hand.

### 2026-10-21 — Staff app in the public look (dashboard, records, admin screens)

Branch `claude/staff-public-look` (PR #20). Frontend only. A BFF from this worktree on `:4900` (its `node_modules` a junction to the main checkout's, no new install) against the local iTop on `:8080`, signed in as the local `admin`; Vite on `:5973` (`VITE_API_MODE=live`). Screenshots from headless Chromium (Playwright 1.63), saved to `docs/design/staff-look/`.

| What ran | Result | Notes |
| --- | --- | --- |
| `npx vitest run` | ✅ 25 files / 135 tests | |
| `npm run typecheck` | ✅ | Also after each step |
| `npm run build` | ✅ | |
| Screenshots, desktop dark: dashboard, record list/detail/new/edit, history, bulk-selection bar, export menu, advanced search, import, transition dialog, impact graph, records index, modules, incidents list and new, an iTop dashboard, Users and user editor, Notifications list and editor, Audit, Queries list/editor/run, command palette, bell, user menu, change password | ✅ | No page errors |
| Same set (most screens) in desktop light, phone (390px) and `dir="rtl"` | ✅ | |
| Phone-width overflow script (document `scrollWidth` vs viewport) on 17 staff routes | ✅ | All fit; Audit reports 1px (subpixel, no element sticks out) |
| Computed colours of the danger button in dark | ✅ | `rgb(31,10,10)` on `rgb(248,113,113)` (was white on light red, ~2.8:1) |

Bugs found and fixed (in this branch):

- Converting `text-left` to `text-start` centred every table header: a `<th>` is centred unless an ancestor sets a non-default alignment, and `start` is the default. `th { text-align: start }` in the base layer.
- At phone width the dashboard was 575px wide. A sortable header's screen-reader-only label is absolutely positioned and escaped the table's scroll box; the box is `relative` now. `Card` (`min-w-0`) and `Tabs` (scroll) no longer let a wide table or tab row stretch the page.
- The public focus rule was unlayered, so it beat every `outline-none` (the command palette input drew a box inside its field); it is in the base layer now.
- Dialog and palette backdrops were ink at 25%, a grey wash once ink is white; they use the `--arcus-scrim` token.
- White text on the light red of the dark look (danger button, count badges) failed AA; a new `--arcus-on-critical` token gives dark text there.
- The change calendar's selected day was white text on the (white) brand colour; it uses `text-on-brand`.
- In RTL the impact graph's labels anchored from the wrong side; the graph is `dir="ltr"` (it is laid out in coordinates).
- On phones the user menu button had no accessible name (its text was `display:none`); the text is now visually hidden instead.

After merging `main` (PR #18 saved queries, PR #19 browser journeys): typecheck ✅, `npx vitest run` ✅ 25 files / 135 tests, build ✅, and the mock browser journeys (`npx playwright test`, the CI E2E job, on `E2E_MOCK_URL=http://localhost:5976`) ✅ 7 / 7 with no selector changes needed.

Not covered: the live journeys (`npm run e2e:live`, needs the BFF and iTop); a screen-reader pass; real Arabic text.

### 2026-10-21 — Browser journeys (Playwright): mock suite in CI, live suite locally

Branch `claude/browser-tests-2dc497`, PR #19. Live runs used this session's own BFF on :4600 (same `.env`, `CORS_ORIGINS`/`APP_BASE_URL` → :5673) and frontend on :5673, against the shared local iTop and Mailpit. The machine was heavily loaded throughout by another session's perf stack (`arcus-perf-itop-1` at ~420% CPU), so iTop calls took 5–60 s.

| What ran | Result | Notes |
| --- | --- | --- |
| Frontend vitest after extending the mocks | ✅ 128/128 | The handlers are shared with the unit tests; nothing changed for them (no session stored = signed-in admin, as before) |
| Typecheck (`tsc -b`, and `tsconfig.node.json` now covering `playwright.config.ts` + `tests/journeys`) | ✅ clean | |
| Mock suite, `npm run e2e` (7 journeys, mock build on :5674, 2 workers) | ✅ 7/7 | After fixes below. With 4 workers on this loaded machine tests hit the 30 s timeout; 2 workers is the setting now |
| Mock suite again after merging `origin/main`, fresh build | ✅ 7/7 (5.8 min, mostly the build on this loaded machine) | One earlier attempt hit the 6-minute webServer limit while the live suite and the perf stack were also running |
| CI, PR #19 first push | ✅ all 4 jobs | New **E2E** job 1m01s (cold Chromium cache), Frontend 1m13s, Backend 31s, Deployment files 11s |
| CI after merging `origin/main` again (the "public look": new sign-in, portal, reset pages) | ❌ then fixed | E2E job: 6 passed, `notifications.spec.ts` failed twice. Strict-mode race: right after clicking "All rules" the editor's breadcrumb and heading both still showed the name, and a strict violation fails at once instead of retrying. Now waits for the list URL and asserts on the table row. Run took 13.4 s; the job 41 s |
| Mock suite locally on the same merge (after `npm ci` for the new font packages) + `tsc -b` | ✅ 7/7, clean | The redesign kept every label and role the journeys use |
| Live suite, `npm run e2e:live`, first full run | 4 ✅, composite ❌ | Sign-in → dashboard, records advanced search (org "My Company/Department"), portal raise/list/comment, forgot password all green against iTop |
| Live: forgot password with the real email | ✅ | Reset email to `e2e.portal@example.test` in Mailpit, link opened, new password set, signed in with it |
| Live: composite (rule in UI → portal request → staff assign + resolve → Mailpit → portal shows it resolved) | ✅ after fixes (4.9m) | Earlier attempts each got further: R-000025 to R-000029 created; iTop resolved them and emailed `e2e.portal@example.test` with subject `E2E <stamp>: R-0000NN is resolved` and the `/records/UserRequest/NN` link (in the HTML part; the text part has none). Final run: R-000030+ |
| Live: full suite after merging `origin/main` (`npm run e2e:live`, 6 tests, 32.7 min) | 5 ✅, composite ❌ at the bell step | All four shared journeys and the reset email green; then `live.spec.ts` alone after the bell step became a `fixme`: composite ✅, reset email ✅, 1 skipped (9.0 min) |
| Live after the public-look merge: `portal.spec.ts` + `live.spec.ts` | ✅ 3 passed, 1 `fixme` skipped (8.3 min) | Portal raise/list/comment, the composite (email in Mailpit), and the reset email, all on the redesigned portal and sign-in |
| Live: in-app notice for the portal caller | ❌ found, kept as `test.fixme` | The rule's `ActionNewsroom` is created, enabled and linked to the same trigger as the email (checked in `priv_action`, `priv_link_action_trigger`), but iTop wrote no `priv_event_newsroom` row for the portal caller, so their bell stays empty. Not fixed here: a product follow-up |

Bugs found and fixed (in the tests and mocks, same branch):

- Mocks had no `/meta/*`, `/objects/*` or `/lookups/*` handlers (records screens and the rule editor showed "Could not reach the server"), no rule create, a portal create that returned an existing ticket, and a session that could not start signed out or as an end user. Added; the mock build points the API at a dead port so any unmocked call now fails the test.
- Organization picker cells showed `#1` instead of the parent's name: the mock lacked `parent_id_friendlyname`, which the BFF sends.
- Locator collisions only the live data showed: the admin's avatar is labelled "My first name My last name", so `getByLabel('Name')` matched it; "Field" also matched "Insert a field". Now by id / exact.
- A live rule save took over 30 s and finished after the test had failed, leaving rule 14 behind (deleted by hand; so were rule 22, left when a 15-minute run hit its time limit mid-cleanup, and probe rule 24 made to inspect the in-app action). Cleanup now waits for the save's own response and deletes whatever it created.
- Under load the BFF gave up on iTop ("iTop took too long to answer") while iTop still resolved R-000026 and sent the email. The live action step now reloads and checks iTop finished, as a person would.

Not covered:

- The mock suite cannot prove what iTop does; that is what the live suite is for, and it is not in CI (no iTop there).
- Test data left in local iTop: portal account `e2e.portal` (person "E2E Portal user", enabled, kept for future runs; password changes every run), User Requests titled `Printer jams on floor 3 …` and `E2E … badge reader at reception` (R-000024 to R-000026 and later). Notification rules created by runs were deleted.

### 2026-10-21 — Saved queries (iTop's query phrasebook and "Run queries")

Branch `claude/saved-queries-d195ca`. Own BFF on :4700 (worktree `.env`, MySQL sessions) and Vite on :3100 over the local iTop :8080.

| What | Result | Notes |
| --- | --- | --- |
| Backend `npm test` | ✅ 495/495 | New `test/queries.test.ts` (17): phrasebook read with the service account, OQL only for administrators, runs/exports as the caller, staff writes only their own condition queries (through the service account), iTop checks admin OQL first and its reason is returned, date conditions and unknown columns refused, parameters bound/refused; `cleanMessage` case for OQL errors |
| Backend `npm run typecheck`, `npm run build` | ✅ | |
| Frontend `npx vitest run`, `npm run typecheck`, `npm run build` | ✅ | New `features/queries/lib/queries.test.ts`; `config/modules.test.ts` updated for the new visible module |
| Live API (`/api/queries`, script, 32 checks) | ✅ 32/32 | Admin: list 13 predefined queries (notification ones marked not runnable), create/run/edit a condition query, CSV and Excel export, save and run a JOIN as OQL, bad OQL → 400 with iTop's reason, class without screens → 400, draft run. Disposable Service Desk Agent account: lists without OQL, runs saved and OQL queries as itself, 403 on raw OQL (save and run), 403 on others' queries, saves/edits/runs/deletes its own. Everything created was deleted and the account disabled |
| Browser (staff account) | ✅ | Queries list, new query → Run (11 User Requests in the records table, links to `/records/…`), save → results page with Export (CSV/Excel/PDF, column picker); records list (refactored Export menu and columns) unchanged |

Bugs found live and fixed (same branch):
- iTop refuses a query with an empty description ("Null not allowed"): the name stands in for it, and is not shown back as a description.
- iTop's OQL errors came back as `Query failed to execute: query = …, exception_class = …, exception_message = …`; `cleanMessage` now keeps only the reason.

Not covered: PDF export of a query (CSV and Excel checked live; PDF goes through the same exporter); a query over a class whose records the staff account's organisations hide (the run is made with the caller's credentials, checked in unit tests, so iTop filters it); conditions on dates (refused by design, as in the audit).

### 2026-10-21 — Public look: landing page, sign-in and password reset, end-user portal

Branch `claude/portal-design-1845da` (PR #17). Frontend only. Vite on `:5973` in mock mode (`VITE_API_MODE=mock`); screenshots from headless Chromium (Playwright 1.63) driven by a script in the session's scratchpad, saved to `docs/design/public-look/`.

| What ran | Result | Notes |
| --- | --- | --- |
| `npx vitest run` (full, 24 files / 128 tests) | ⚠️ 126 / 128 | The 2 failures were `AttachmentsPanel.test.tsx` `findByText` timeouts: the machine was heavily loaded (run took 12.5 min, setup 924 s), and this PR does not change that component |
| `npx vitest run src/features/attachments` (re-run alone) | ✅ 11 / 11 | Same tests pass once the machine is less busy |
| `npm run typecheck` | ✅ | Also after each step of the change |
| `npm run build` | ✅ | 8 self-hosted `.woff2` files (Hanken Grotesk + Noto Sans Arabic subsets, 308 KB); no font CDN in the CSS |
| Screenshots, phase 1: landing, sign-in, portal home × desktop/phone × dark/light | ✅ | Reviewed by eye; user approved the look |
| Screenshots, phase 2: my requests, request detail, new request, knowledge base, article, profile, change-password dialog, bell, forgot password (form and "sent"), reset password, desktop dark/light, phone dark | ✅ | No page errors in the console |
| `dir="rtl"` screenshots: landing, sign-in, portal home, the portal pages | ✅ | Layout, nav order, check lists and arrows mirror |
| WCAG AA contrast of every public token pair (script) | ✅ | Text ≥ 4.98:1 in light, ≥ 5.63:1 in dark; buttons ≥ 16:1; input borders ≥ 3:1 |

Bugs found and fixed (in this branch):

- The bare `<input>` inside the `Input` wrapper drew its own focus outline inside the wrapper's ring (a box in a box) in the public look; the inner outline is off there.
- The change-password dialog's backdrop was the ink colour at 25%, which turns a washed-out grey once ink is white; dialogs now use a `--arcus-scrim` token (same values as before for staff).
- On phones the My requests table clipped its status and date columns; phones get a stacked list instead.
- Textareas and the urgency select had a `border-line` edge (about 1.3:1, below the 3:1 AA asks for); they use `border-line-strong` now.

Not covered: Playwright journeys against the real BFF and iTop (the browser-tests session owns them); a screen-reader pass; real Arabic text (only `dir="rtl"` with English copy).

### 2026-10-21 — Production iTop in the prod stack: install, cron, lock-down, backup/restore

Branch `claude/great-williams-dba424`. The whole production stack (`docker/docker-compose.prod.yml` + `docker-compose.prod.localtest.yml` for Mailpit) on Docker Desktop, compose project `arcus-itoptest`, web on `:8098`, Mailpit on `:8026`, test env files in the session's scratchpad (not in the repo). The shared `itop-local`, `itop-mailpit` and `itop_prod` were not touched. Only `itop-local-cron` was added to `docker-compose.local.yml`; it was not started (it would run cron against the shared `itop_prod`).

| What ran | Result | Notes |
| --- | --- | --- |
| Compose files resolve (`config -q`): prod, prod+itop-admin, prod+localtest, local | ✅ | Same commands as the new CI job |
| shellcheck 0.10 on every new script | ✅ | After two fixes (SC2016 note on the inline PHP, SC2010 `ls \| grep` in restore) |
| Build: `arcus-itop` (iTop/ baked in), `arcus-bff`, `arcus-web` | ✅ | pecl.php.net was down (504) for a while: APCu now in its own layer, pinned 5.1.24 |
| From nothing (`down -v`, `up -d`) | ✅ | MySQL created `itop` and `arcus_bff` with their users; bff healthy; web unhealthy until the install (expected); cron waiting |
| `itop-setup`, first install (46 modules) | ✅ | 1–7 min on this machine. configure.php set timezone `Asia/Kolkata`, SMTP → mailpit, async email, sender; created `arcus-service` (Administrator + REST Services User), gave `admin` REST Services User. Config stays 0440 |
| Health after install | ✅ | All 7 services healthy; `/health/upstream` ok as the service account |
| Lock-down, from the BFF container | ✅ | `rest.php`, `export-v2.php`, `import.php` 200; `cron.php`, `pages/UI.php`, `index.php`, `setup/`, `portal/`, `conf/…/config-itop.php`, `env-production/`, `status.php` 403. iTop publishes no port; `db` has no route out (internal network) |
| Sign-in through the platform | ✅ | API through nginx, and in the browser (dashboard, bell badge, Organizations list with New/Import/Export) |
| Ticket and SLA through the platform API | ✅ | Team, service family, service, SLT (TTO 1 minute, priority 4), SLA, customer contract + service link, two user requests. TTO deadline = start + 1 min; times read back correctly in UTC with iTop on Asia/Kolkata. Request A assigned and resolved |
| SLA job via cron | ✅ | Request B, left New, moved to `escalated_tto` with `sla_tto_passed=yes` once its TTO passed (twice: first stack, clean run) |
| iTop mail via the queue | ✅ | A notification rule made in the platform (created, to the caller, + bell): the email reached Mailpit from `helpdesk@example.com` ~1 s after the ticket |
| Scheduled backup (`BACKUP_TIME` 2 min ahead) and `run --rm backup backup` | ✅ | 9.2 MB: `itop.sql.gz`, `arcus_bff.sql.gz`, `itop-files.tar.gz` |
| Restore onto wiped volumes (`down -v`, `up -d`, `stop`, `run --rm backup restore <stamp>`, `up -d`) | ✅ | All healthy; admin signs in with the restored password; both requests back as they were; cron resumed |
| `itop-setup --upgrade` | ✅ | 2.5 min; cron paused (maintenance, then waiting for the setup) and resumed |
| Emergency console override | ✅ | `ITOP_ADMIN_UI=true`, iTop's login page on 127.0.0.1:8089 only; closed again by `up -d itop` without the file (8089 gone, console 403 from the BFF) |
| After merging main (PR #14 security pass, audit editing): bff + web rebuilt, `up -d` | ✅ | All healthy, `/health/upstream` ok, the new CSP header served, sign-in and both requests read back |

Bugs found and fixed (in this branch):

- The base image's `/var/www/html` is world-writable and owned by www-data; the code root is now root's, 0755.
- The setup compiles into `env-production-build` next to the code root, which is not writable any more: the image creates it for www-data (iTop copies it into the `env-production` volume, it does not rename, so the volume works).
- The iTop health check failed until installed (`rest.php` answers 500 before); it now only checks that Apache and PHP answer.
- Right after the install, configure.php died on a half-written `expressioncache-ENUS.php`: cron.php started the moment the config file appeared and built the same caches. itop-setup now writes `data/arcus-setup.done` when finished, and the prod cron waits for it (and pauses whenever itop-setup runs).
- MySQL's first start (~70 s here) outran the health check's start period, so the BFF and iTop started before it; start period now 300 s.
- Python on Windows wrote two scripts with CRLF; `docker/.gitattributes` keeps `*.sh` LF, and the scripts are now executable in git (the backup entrypoint is bind-mounted and would not run on a Linux checkout). CI checks both.

Not covered:

- Everything ran on Docker Desktop for Windows, not a Linux server; bind-mounted scripts are executable there whatever git says (CI now checks the mode).
- Real SMTP (only Mailpit), TLS proxy, an external MySQL (`COMPOSE_PROFILES=` empty), and `ITOP_DB_TLS`.
- No backend or frontend code changed, so their unit tests were left to CI.
- `itop-local-cron` was not started (see above).

### 2026-10-21 — Impact graph export and grouping, "My changes", portal uploads under the end user

Branch `claude/small-items-42d376`.

| What ran | Result | Notes |
| --- | --- | --- |
| Backend unit tests + typecheck + build | ✅ 437/437, clean, built | New: Changes queue from iTop's `MyChanges` view with iTop's status labels (per class, falling back to Change's), soonest first, empty without the view; portal upload sends the end user's `user_id`/`contact_id` and names them; no `contact_id` without a person; no `finalclass` asked of Attachment |
| Frontend unit tests + typecheck + build | ✅ 123/123, clean, built | New: `graph-layout` grouping (fold ≥5 of a class at a depth, one arrow per pair of boxes, expand, threshold off, root never folded), `graph-export` (standalone SVG, backdrop, page orientation), `MyAssignmentsCard` Changes tab (label, link to `/records/NormalChange/31`, View all, empty state). jsPDF 4.2.1 is loaded on demand (own chunk); `npm audit --omit=dev`: 0 |
| Live, BFF on :4500 against local iTop: dashboard | ✅ | Test change C-000021 (NormalChange) walked new → validated → assigned (agent admin) → planned; `myAssignments.changes` listed it as "Assigned", then "Planned and scheduled"; `/api/objects/Change?view=MyChanges` lists it |
| Live: portal upload | ✅ | Throwaway portal user raised R-000023 and uploaded a file; iTop's Attachment row has `user_id` 7 / `contact_id` 9 (the portal user and their person), not the service account; the portal list shows "Pia Portaltest". Both throwaway accounts disabled afterwards |
| Live: impact graph in the browser (frontend :5573) | ✅ | srv-432887 with six test OtherSoftware instances: drawn as "6 × OtherSoftware"; click expands to 7 boxes and "Fold groups again" appears; Download PNG gave a 128 KB PNG, Download PDF a PDF (2.1 MB before turning on jsPDF's compression, 17 KB after, folded graph) |

Bugs found and fixed (same branch):

- iTop's Change menu is `MyChanges`, not `Change:MyChanges` like the ticket menus: the queue was empty until the live check showed it.
- Every attachment upload and list failed with "invalid attribute code 'finalclass' for class 'Attachment'": since 1234db8 the BFF adds `finalclass` to every explicit field list, but iTop only defines it on classes in a hierarchy. It is now added only there.
- PDFs were ~10x larger than needed (jsPDF stored the pixels raw); now deflated.

Not covered / found:

- The dashboard's Changes tab was not looked at in the browser: the hidden browser pane would not finish rendering the dashboard. The BFF response and the component test cover it.
- Test data left in local iTop: NormalChange C-000021, OtherSoftware `zz-small-items-sw-1..6` on srv-432887, UserRequest R-000023 with one attachment, disabled users `pia1097`/`pia56005`.
- The ticket tables' ID link always points at `/incidents/<id>`, also on the Requests and Problems tabs (pre-existing).
### 2026-10-21 — Editing the audit: categories, rules and domains

Branch `claude/audit-editing-021ce6`.

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/audit-editing.test.ts`, in-memory iTop) | ✅ 14/14 | Category and rule read back as record type + conditions (no OQL), key names for conditions, create with tolerances and domains, no conditions = every record, refusals before any write (name, unknown type, tolerances, unknown domain, dates, rule without conditions), domain links moved, a JOIN definition kept whole / refused with conditions / dropped, record type locked while rules exist, kept part of a rule ANDed back, delete answers 409 naming the rules then deletes rules before the category, domains CRUD, options |
| Extra criteria / condition tests | ✅ | "not empty" written without `NOT` for every kind; the old `NOT (…)` form read back and rewritten; bare `SELECT Class` read as no conditions |
| Backend `npm test` + typecheck | ✅ 450/450, clean | Run again after the NOT fix |
| New frontend tests (`features/audit/lib/editing.test.ts`) | ✅ 5/5 | `?run=` parameter, tolerance checks, delete question naming the rules |
| Frontend vitest + typecheck + build | ✅ 119/119, clean, built | |
| Live check, own BFF on :4400 against local iTop (script, signed in as the local admin) | ✅ 20/20 after the fix | Domain, category (`status IN ('production')`, tolerances 10/40, domain) and rule (serial number empty, faulty) created; iTop rows checked by REST; category and rule runs match direct iTop counts; rule switched to "valid / serial not empty" gives the same failures; category edited (two statuses, domain removed, link gone in iTop); record-type change refused; delete without `withRules` → 409 naming the rule; with it → category and rule gone in iTop; domain deleted. The existing "Servers" category and its 3 rules read back (one keeps a part set up in iTop) |

| Follow-up: rules on a parent class (idea from another session's unfinished copy) | ✅ backend 451/451 + typecheck; audit vitest 12/12; build | New test on the real schema: a rule `SELECT FunctionalCI WHERE business_criticity IN ('high')` under a Server category reads back as a condition and is edited in place |

Bugs found and fixed (same commit):

- **"Is not empty" never worked in iTop.** `criterionToOql` wrote it as `NOT (…)`, but iTop's OQL has no `NOT` ("Unexpected token PAR_OPEN"), so a "not empty" condition failed in advanced search and notification conditions too, and here a "valid" rule could not run. It is now `x != 0` (pickers), `x != ''` (text, lists) and `ISNULL(x) = 0` (numbers, dates), checked against iTop (complementary counts). The old form is still read, so a rule saved with it is rewritten correctly on its next save.
- The first live run's run call sent a JSON content type without a body (script bug, not the BFF).

Not covered:

- The editors were not looked at in a browser: typing the local admin password into the sign-in page was not allowed in this session. The live check went through the same API the screens call.
- Conditions on dates are refused for audit rules (as for notifications): a fixed date cannot be read back as a condition.
### 2026-10-21 — Security pass before go-live: sign-in rate limiting and review fixes

Branch `claude/security-hardening-1b379d`. Findings and reasoning: `docs/security-review.md`.

| What ran | Result | Notes |
| --- | --- | --- |
| Probe of the guard with encoded paths (`app.inject`, before the fix) | ❌ found | `/api/%61dmin/users` 200 for a non-admin; `/%61pi/admin/users` 200 with no session, run as the service account |
| New/changed backend tests: auth (encoded paths, rate limiting, origin with `*`, change-password limit), rate-limiter, trust-proxy, client credentials, raw OQL refusal, CSV formulas, 5xx answers, security headers, prototype keys, attachment types/names, default organisation, user relink | ✅ all pass | |
| Backend `npm test` + `npm run typecheck` + `npm run build` | ✅ 455/455, clean, built | The first typecheck caught two of my own errors (Fastify's `trustProxy` type has no number; a stray `asService` on `applyStimulus`), both fixed before commit |
| Frontend `npx vitest run` + `npm run typecheck` + `npm run build` | ✅ 114/114, clean, built | Built `index.html` has no inline script left (theme bootstrap moved to `/theme-init.js` for the CSP) |
| `npm audit` | backend 0; frontend 6 (dev tooling only) | vitest/vite/esbuild/tinypool; fix is vitest 5, left for a separate change |
| Live: own BFF on :4300 (worktree `.env`, MySQL sessions) over local iTop :8080 | ✅ | Good sign-in 200; 5 bad for one login 401 then 429 with `Retry-After: 887`; 10 bad from one address then 429 for every login; after restart 4 bad + good → 200 and the count cleared (5 more bad = 401, then 429); encoded paths 401; API headers present |

Bugs found and fixed (same commit): the encoded-path guard bypass (critical), the silent fallback to the service account, no sign-in limits, `TRUST_PROXY=true` letting clients choose their address, raw `?oql=`, CSV formula injection, internals in 5xx answers, missing security headers/CSP, page-like attachment types and non-Latin file names (500), cross-origin writes unchecked with `CORS_ORIGINS=*`, the default-organisation cache following the first caller, sessions kept after a contact relink, `constructor`-style keys giving 500s.

Not covered:

- The CSP was checked against the built `index.html` (no inline scripts), not in a browser behind the real nginx image; no Docker build was run in this session.
- The rate limits were not tested across several BFF instances (they are per instance by design).
- The frontend dev-tooling advisories are not fixed (vitest 5 upgrade).

### 2026-10-20 — Export column picker, import column mapping, class labels on lists

Branch `feature/export-columns-import-mapping`.

| What ran | Result | Notes |
| --- | --- | --- |
| Backend transfer tests (`backend/test/transfer.test.ts`) | ✅ 15/15 | New: CSV read/write (quoted separators, doubled quotes, line breaks, other qualifier), remap drops skipped columns, import sends mapped headings, file untouched without a mapping, refusals (unknown attribute, path on a non-picker, column-count mismatch, two columns into one field, all skipped), report cell holding `;` |
| Backend unit tests + typecheck | ✅ 401/401, clean | |
| New frontend tests: `lib/import-mapping.test.ts`, `lib/export-columns.test.ts`, `pages/transfer-screens.test.tsx`, extra `headerOf` case | ✅ 10 + 5 + 4 + 1 | Mapping guesses by code/label, "(ID)"/"(name)", "id (Primary Key)", "Label->Name"; export defaults, picker → `_friendlyname`, localStorage per class incl. junk and throwing storage; rendered list heading, export picker and mapping step |
| Frontend unit tests + typecheck + build | ✅ 102/102, clean, built | First full run: 2 of the new screen tests failed on vitest's 5 s timeout under parallel load (they pass alone in ~2 s); given a 30 s timeout, then 102/102 |
| Live export through a BFF on :4200 | ✅ | UserRequest `id,ref,title,org_id_friendlyname,status` as CSV (names, not ids); `ref,title,caller_id_friendlyname` as Excel (5 KB) and PDF (149 KB); `fields=ref,bogus` refused with 400 |
| Live import, simulate only | ✅ | `;`-separated file headed `Subject;Organization;Caller;Notes;Urgency` mapped to `title, org_id->friendlyname, caller_id->friendlyname, (skip), urgency`, matched on title: row 1 "to create", row 2 matched R-000017 and iTop refused urgency (read-only once resolved). Search afterwards: nothing written |

| After merging main (CI, PR #9 time zones) — CI's commands | ✅ | Backend: typecheck clean, 420/420, build OK. Frontend: `tsc -b` clean, 107/107, build OK. Only this log conflicted; #9 did not touch the transfer code |

Bugs found and fixed (same commit):

- The import report split a cell holding `;` (`"Mapped import check; one"` showed as two cells); rows and headings are now read as qualified CSV.
- A picker matched on `->name` would use a person's last name only; mapping now uses `->friendlyname`, which iTop's import accepts and which is what the export writes.

Not covered / found:

- The new screens were not looked at in a browser: the frontend needs a real sign-in, and no test account is in the repo's example files. The component tests render them instead.
- Unticking every "match on" column does not create every row for UserRequest: iTop falls back to the class's reconciliation key (`ref`) and refuses a file without it. This was already the case before this change.
- iTop's CSV export writes enum labels ("Resolved") while the import reads codes, so an exported status column does not import back unchanged.
- The test-run hook writes to `$CLAUDE_PROJECT_DIR`, the main checkout, so runs from this worktree were recorded in the main folder's `TEST_LOG.md`, under the main folder's branch. This entry records them instead.

### 2026-10-20 — Audit screen (iTop's data-quality audit)

Branch `claude/xenodochial-merkle-a3288c`.

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/audit.test.ts`) | ✅ 13/13 | Class of a query (incl. `SELECT a FROM X AS a`), iTop's tolerance colours, faulty vs valid rules (by class and id, records outside the set ignored), category run (per-rule counts, union, a rule iTop cannot run), one-rule run, empty set, unreadable set, 500-record cap, transport errors rethrown, 404s, no OQL in any response |
| New frontend tests (`features/audit/lib/runs.test.ts`) | ✅ 7/7 | Merging whole and one-rule runs, percent never rounds a failure up to 100% |
| Backend unit tests + typecheck | ✅ 404/404, clean | |
| Frontend unit tests + typecheck + build | ✅ 89/89, clean, built | |
| Live: API on own BFF (:4100) against local iTop | ✅ | Sample data created in iTop (category 1 "Servers", rules 1–3, domain 1 "Infrastructure"). Both servers fail "Has a serial number" and "Has a location" (valid-list rules), none fail "Not obsolete" (faulty-list rule) — matches the servers' fields; unknown rule → 404 |
| Browser: Audit screen | ✅ | Run all → "Needs work", 2 of 2 failing, per-rule counts and badges; drill-down lists both servers; link opens `/records/Server/2` |

Bug found and fixed: the first browser run got an HTTP 500 from iTop ("Packets out of order" from MySQL while four REST calls ran at once). Transient, but rules now run one at a time (as iTop's own page does), and "Run all" runs categories one after another.

Not covered: a category with more than 500 failing records against the live iTop (unit test only); a non-administrator calling the routes (the existing `/api/admin` guard, covered by the auth tests).

After merging main (CI, time zones, the bell): backend 423/423 and typecheck clean; frontend 94/94, `tsc` clean, build passes. The run time on the Audit screen now uses the shared `friendlyDateTime` helper (it is a server-made ISO instant).
### 2026-10-20 — Production images and compose (deployment)

Branch `claude/pensive-grothendieck-3b0ba2`. Docker 29.3.1 on Windows, local iTop on :8080 reached as `host.docker.internal`, sessions in the Windows MySQL (`arcus_bff`), Mailpit for SMTP. Stack started as project `arcus-prodtest` on `127.0.0.1:8088`.

| What ran | Result | Notes |
| --- | --- | --- |
| `docker build -f backend/Dockerfile .` | ✅ built | Multi-stage, `npm ci` → `tsc` → prod deps only; runs as `node` (uid 1000) |
| `docker build frontend` | ✅ built | Vite build in the image (~1.5 min); MSW worker not shipped (`/mockServiceWorker.js` falls back to `index.html`) |
| `docker compose -f docker/docker-compose.prod.yml up -d` | ✅ both healthy | BFF: schema loaded (158 classes), session store `mysql` ready; web's check reached iTop through `bff:4000/health/upstream` |
| Caching headers | ✅ | `index.html` and SPA routes `no-cache`; `/assets/*.js` `public, max-age=31536000, immutable`; deep link `/incidents/123` → 200 (SPA fallback) |
| Sign-in through nginx (curl) | ✅ | `POST /api/auth/login` 200, `intertec_sid` HttpOnly; `/api/auth/me` = admin; same call with `Origin: http://evil.example` → 403 |
| Dashboard data | ✅ | `/api/dashboard/overview?range=7d` 200 with live counts (8 incidents, 1 open); `/api/meta/navigation` 200 |
| Session survives `docker restart` of the BFF | ✅ | `/api/auth/me` 200 after restart (MySQL store) |
| Browser: `http://localhost:8088/` | ✅ partly | Redirects to `/login`, page renders with "Forgot password?" (SMTP on) |

After merging main (PRs #8 CI and #9 dates) at `45e3e54`: backend typecheck clean, 410/410 tests, build ✅; frontend typecheck clean, 87/87 tests, build ✅; GitHub Actions on PR #10: Backend (BFF) ✅, Frontend ✅.

Bugs found and fixed before the commit: `/assets/` sent `Cache-Control` twice (`expires 1y` plus the explicit header; `expires` removed); `/health/upstream` took 13 s against the local iTop, so web's health-check timeout went from 15 s to 30 s.

Not covered: signing in through the browser form (the session was not allowed to read the admin password to type it; the same login was checked with curl); HTTPS with `COOKIE_SECURE=true` behind a real TLS proxy; a Linux host (`host-gateway`); password-reset mail from the container.

### 2026-10-20 — iTop dates in the viewer's time zone, everywhere

Branch `feature/itop-dates`. Follows up the bell's "Not covered".

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/itop-time-paths.test.ts`) | ✅ 13/13 | Field conversion (DateTime, case-log dates, stopwatch deadline; Date-only, String and timespent untouched); ISO in → Paris text; iTop-calendar day maths; `oqlDate` on iTop's clock (Paris and Kolkata); ObjectsService get/create (+ `toTicket.createdAt`); criteria with an instant and a bare day; portal list + detail + log; history date and a DateTime change; notification send log; dashboard ranges, change week and trend buckets with the clock pinned at 00:30 Paris / 22:30 UTC |
| New frontend tests (`lib/utils/format.test.ts`, +1 in `list-cells.test.ts`) | ✅ 4/4 | Instant detection; local display; datetime-local round trip; DateTime list cell vs Date |
| Backend unit tests + typecheck + build | ✅ 410/410, clean, built | |
| Frontend unit tests + typecheck + build | ✅ 87/87, clean, built | |
| `npm run smoke` | ✅ 13/13 | |
| `api-check.mjs` | ✅ 70/70 | First run 69/70: `GET /api/incidents?limit=2&page=2` got iTop HTTP 500 once while other test runs loaded the machine; passed on re-run, unrelated |
| Live spot check (I-000020) | ✅ | iTop `start_date` "2026-10-20 15:22:23" (Paris) → BFF `2026-10-20T13:22:23.000Z` on `/api/objects`, `/api/incidents`, case log, history, dashboard recent list; send log likewise |

What changed: the BFF now sends every iTop DateTime as an ISO instant (ObjectsService converts by the schema, so records, tickets, incidents, attachments and dashlets all get it; portal, history and the send log convert their own reads). Datetimes written or filtered on may be ISO instants and are moved onto iTop's clock; dashboard ranges and trend days use iTop's calendar rather than the BFF host's. The frontend formats instants locally (record fields and list cells, case logs, history, send log, portal) and the datetime inputs (record forms, new incident) edit on the viewer's clock and send instants.

Not covered: no browser pass of the screens (unit tests + live API only); portal endpoints not hit live (no portal session in this run); no live write of an ISO datetime (unit-tested). A bare-day date filter still means iTop's day, not the viewer's; dashboard trend days are iTop's days. Exports keep iTop's own text.

### 2026-10-20 — Automatic checks (CI) on every pull request

Branch `feature/ci`, in a separate worktree.

| What ran | Result | Notes |
| --- | --- | --- |
| The CI steps by hand, from a clean `npm ci`, backend | ✅ typecheck clean, 397/397, build | |
| The same, frontend | ❌ 82/83 → ✅ 83/83 | A component test passed Vitest's 5 s limit while five sessions shared the laptop; passes on a re-run |

Fix: Vitest's per-test limit raised to 20 s (`frontend/vite.config.ts`), so a slow shared CI runner does not fail a passing test.

From now on GitHub Actions runs these checks on every PR and every push to main; its results are on the PR, not repeated here. Tests needing a running iTop (`npm run smoke`, `api-check.mjs`) stay local.

### 2026-10-20 — The bell: iTop's in-app notifications in the platform

Branch `feature/bell-notifications`.

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/inbox.test.ts`, +1 in `notifications.test.ts`) | ✅ 6/6 | Only the caller's own, newest first, plain text; someone else's refused; mark one / all; no linked person; iTop times in Paris, summer and winter, and Kolkata; a rule's in-app part created and removed with it |
| Frontend test (`NotificationBell.test.ts`) | ✅ 1/1 | Badge text |
| Backend unit tests + typecheck | ✅ 397/397, clean | |
| Frontend unit tests + typecheck + build | ✅ 83/83, clean, built | |
| Live: assigning I-000009 (iTop's sample in-app rule linked to "Incident enters Assigned") | ✅ | Count 1; listed for admin; the portal user sees none and gets 404 marking it; still 403 on staff APIs; mark read → 0 |
| Live: in-app switched on for "Request resolved" from the API | ✅ | ActionNewsroom created on the same trigger (caller, our wording); resolving R-000017 (high priority) put "Your request R-000017 is resolved" in admin's bell; off removed it, on recreated it |
| Browser: bell | ✅ | Badge 1; panel lists both; "4 minutes ago"; clicking opened `/incidents/9` and cleared the badge; bell also in the portal header |
| Browser: rule editor "In the app" | ✅ | Rule 10 shows it ticked with its message |
| `npm run smoke`, `api-check.mjs` | ✅ 13/13, 70/70 | |

Bug found and fixed: times showed "4 hours ago" for new notifications. iTop writes dates as local text in its own zone (Europe/Paris here) and the browser (India) read them as its own; the BFF now converts them using `ITOP_TIMEZONE`.

Not covered: other screens still show iTop's dates as written (in iTop's zone), unchanged by this work.

### 2026-10-20 — "Only when…" conditions on notification rules

Branch `feature/notification-conditions`.

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/notification-conditions.test.ts`) | ✅ 6/6 | Writes the filter; reads back every operator it writes (including `'` and `%` in text); keeps and re-ANDs what it cannot show; keeps a JOIN filter whole and refuses to combine it; no split inside quotes/brackets; bad values refused |
| Backend unit tests + typecheck | ✅ 391/391, clean | |
| Frontend unit tests + typecheck + build | ✅ 82/82, clean, built | Condition rows moved out of advanced search into a shared component |
| Live: API round trip on rule 7 | ✅ | priority, organization, a title with `it's 50% done`; filter stored in iTop as expected; organization shown by name |
| Live: does iTop apply it? | ✅ | Condition "priority Critical or High": resolving R-000015 (low) sent nothing; resolving R-000016 (high) emailed the caller |
| Browser: rule editor | ✅ | Saved condition shown; added "Organization is any of My Company" with the record picker; saved and reloaded intact; no date fields offered |
| Browser: advanced search on User Requests | ✅ | Still works after the refactor ("priority is Low" → 4 records) |

Not covered: iTop's newsroom (in-app) notifications.

### 2026-10-20 — Notification rules screen

Branch `feature/notifications`.

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/notifications.test.ts`) | ✅ 13/13 | Recipients both ways (roles, people, kept custom parts, OR inside sub-queries/quotes), texts both ways (escaping, our link, iTop's encoded link, iTop's hyperlink), create writes, delete keeps shared parts, validation |
| New frontend tests (`features/notifications/lib/describe.test.ts`) | ✅ 3/3 | Plain-language events, recipients, field insertion at the cursor |
| Backend unit tests + typecheck | ✅ 385/385, clean | |
| Frontend unit tests + typecheck + build | ✅ 82/82, clean, built | |
| Live API against iTop 3.4 | ✅ | Listed iTop's 3 mention rules; created state, changed-fields and SLA rules; status switch; changed a rule's event type (old trigger removed); delete left no trigger or email behind |
| Live send: resolved R-000010 | ✅ | iTop emailed the caller (cc agent) through Mailpit; fields filled; link opened `/records/UserRequest/10` in the platform |
| Browser: rule created in the editor, test mode | ✅ | Missing test address caught; fields inserted at the cursor; assigning I-000009 sent only to the test address, subject marked TEST |
| Browser: rules list, Recently sent | ✅ | Display names, mention rules flagged, sent log with results |
| `npm run smoke`, `api-check.mjs` | ✅ 13/13, 70/70 | |

Bugs found and fixed before commit:
1. iTop requires a sender on every email rule; rules now use NOTIFICATION_FROM / MAIL_FROM.
2. iTop's HTML cleaner URL-encodes `$this->id$` in links, so the link did not read back as `{{link}}`; the reader accepts both forms (iTop still fills in the encoded one).
3. The list showed codes ("resolved", "team_id"); the BFF now sends display names.
4. A class labelled with an untranslated format string showed as `%2$s for class %1$s`.

Not covered: "only when" conditions (kept, not editable); iTop's newsroom notifications; a real mail server.

### 2026-10-20 — Mailpit test mailbox for the BFF and iTop

| What ran | Result | Notes |
| --- | --- | --- |
| Mailpit v1.31.6 started from `docker/docker-compose.local.yml` | ✅ | Web inbox on :8025 answers 200; iTop still up |
| iTop sends through its own `Email` class (synchronous), SMTP to `mailpit:1025` | ✅ sent | Arrived from helpdesk@intertecsys.com |
| BFF `POST /api/auth/forgot-password` for a portal user | ✅ 202 | Reset email arrived in Mailpit with the link |
| Mailpit inbox in the browser | ✅ | Both messages listed |

Not covered: a real mail server (waiting for IT: Microsoft 365 mailbox, SMTP AUTH or OAuth); iTop notification rules themselves (not built yet).

### 2026-10-19 — Forgot password by email

Branch `feature/forgot-password`.

| What ran | Result | Notes |
| --- | --- | --- |
| New backend tests (`backend/test/password-reset.test.ts`) | ✅ 14/14 | Link in fragment, by login and by email, no mail for unknown/disabled/LDAP/no-email accounts, single use, sign-out everywhere, link kept when the password is refused, newer link replaces older, rate limits, HTML escaping, off without SMTP, routes public and uniform |
| New frontend tests (`features/auth/lib/reset-token.test.ts`) | ✅ 3/3 | Token parsing, password checks |
| Backend unit tests + typecheck | ✅ 372/372, clean | |
| Frontend unit tests + typecheck + build | ✅ 79/79, clean, built | |
| Live: local SMTP test mailbox + BFF + iTop | ✅ | Unknown and real account both 202 in ~20 ms; one email to the real account only; link opened in the browser, token dropped from the address bar, mismatch caught, password set; old password 401, new 200; used link 400; original test password restored the same way; no rows left in `bff_password_resets` |

`npm audit` flagged nodemailer 6 (11 advisories); 10.1.7 is used instead (0 found).

Not covered: a real SMTP server (waiting for its details); STARTTLS/TLS (the test mailbox is plain); several BFF instances sharing the rate limits.

### 2026-10-19 — Review of the 6 commits not yet in main

PR #2 was merged with its first two commits only; the six pushed after it were reviewed before a new PR.

| What ran | Result | Notes |
| --- | --- | --- |
| Independent review of `origin/main..HEAD` | 3 findings, all fixed | Auth hook change, OQL injection, crypto basics, expiry, bulk delete checked and found correct |
| New unit tests: copied session blob, refused queue | ✅ 2/2 | |
| Backend unit tests + typecheck | ✅ 358/358, clean | |
| Hook pipe-test: background, moved-to-background, foreground | ✅ | Background runs now say so instead of "no summary line" |
| Live: sign in, `/api/auth/me`, dashboard queues | ✅ 200, 200, 1/1/1 | |

Findings fixed:
1. Medium: a sealed session was not bound to its row, so someone able to write `bff_sessions` could copy an admin's blob onto their own row. The seal now authenticates the id hash and user id. Sessions sealed before this no longer open (one-time sign-in).
2. Low: one queue iTop refused (e.g. no right to read Problem) failed the whole dashboard; now that queue is empty.
3. Low: the test-log hook logged background runs as "no summary line".

### 2026-10-19 — Sign-ins survive BFF restarts (MySQL session store)

| What ran | Result | Notes |
| --- | --- | --- |
| New unit tests (`backend/test/session-mysql.test.ts`) | ✅ 7/7 | Read back after a "restart", nothing readable stored, wrong secret, tampered row, idle and max life, idle timer written at most once a minute, sign-out everywhere, password change |
| Backend unit tests + typecheck | ❌ 348/349 → ✅ 356/356, clean | See bug below |
| Live: sign in, restart the BFF, same cookie | ✅ | `/api/auth/me` still signed in; a lifecycle change ran as the user (History shows their name); sign-out then 401 |
| Live: row in `arcus_bff.bff_sessions` | ✅ | Key is a SHA-256, not the cookie; the iTop password is not found in the stored bytes |
| Live: `npm run smoke`, `api-check.mjs` with `SESSION_STORE=mysql` | ✅ 13/13, 70/70 | |

Bug caught by the existing sign-in test: once the session lookup became async, the guard (an async Fastify hook) bound the caller in an async context the route handler does not inherit, so `/api/auth/me` saw nobody signed in. The hook now uses the callback form and hands over from the context that bound the caller.

Not covered: two BFF instances running at once (the store is shared, but only one instance was run); a real MySQL outage mid-session (requests then fail with an error rather than signing out).

### 2026-10-19 — Record lists show names, not ids

| What ran | Result | Notes |
| --- | --- | --- |
| New unit tests (`frontend/src/features/records/lib/list-cells.test.ts`) | ✅ 5/5 | Name beside each picker, link target, iTop's 0 as empty, id fallback, enum wording |
| Frontend unit tests + typecheck | ✅ 76/76, clean | |
| Browser, live BFF: Problem and UserRequest lists | ✅ | Organization, Caller and Agent show names; unassigned shows "—"; a caller name opens that Person |

Bug fixed: generic record lists showed external keys as raw ids ("Organization 1", "Service 0"). The list now also requests `<attcode>_friendlyname`, which iTop returns for every external key.

Not covered: the list heading still shows the class code ("UserRequest"), not its label.

### 2026-10-19 — My assignments on the dashboard

| What ran | Result | Notes |
| --- | --- | --- |
| New unit tests (`backend/test/my-assignments.test.ts`) | ✅ 4/4 | Views bound to the caller's contact, priority order, real totals, no Person, missing view, `assignee=me` |
| Backend unit tests + typecheck | ✅ 349/349, clean | |
| Frontend unit tests + typecheck + build | ✅ 71/71, clean, built | |
| Live: `GET /api/dashboard/overview` as admin | ✅ | Seeded I-000009, R-000010, P-000011 assigned to admin (team Team432887); each queue returned its one ticket |
| Live: `GET /api/incidents?assignee=me` | ✅ | Before this change the BFF rejected `me` with a 400, which the card's "View all" link sent |
| Browser, live BFF | ✅ | Tab counts 1/1/1, row click opens the record, every "View all" opens a matching filtered list |

Bug found and fixed in the same change: the incidents "View all" link listed closed incidents too (2 against the card's 1); it now filters to open statuses.

Not covered: approvals (extension not installed, so the tab was replaced by Problems); changes assigned to me (their statuses do not fit the ticket columns); queues over 50 rows show the first 50 and point to View all.

### 2026-10-19 — Fast iTop setup made the default; test-log recorder fix

| What ran | Result | Notes |
| --- | --- | --- |
| File read benchmark: Windows folder mount vs Docker volume | 9.7 s vs 0.1 s for 120 iTop files | Cause of the lag on bind-mounted setups; README now defaults to `docker/docker-compose.local.yml` |
| Recorder pipe-test: 3 real runs, 3 commands that only mention tests | ✅ 3 logged, 3 ignored | It had logged a commit whose message named `api-check` |

### 2026-10-19 — BFF review, iTop parity (steps 1–6), portal, first live run

Branch `feature/itop-parity`, PR IntertecAitools/ARCUS-Itop#2.

| When | What ran | Result | Notes |
| --- | --- | --- | --- |
| Start | Backend unit tests + typecheck (baseline) | ✅ 275/275, clean | Before any change |
| BFF review | Backend unit tests | ✅ 290/290 | 15 regression tests for the 11 review fixes |
| Steps 1–6 | Backend / frontend unit tests, typecheck, build | ✅ 331/331 · 71/71 · clean | Grew with each step |
| Portal | Backend / frontend unit tests, build | ✅ 340/340 · 71/71 · clean | Portal also checked in the browser in mock mode |
| Live, first run | `npm run smoke`, `npm run smoke -- --write` | ✅ 13/13, 18/18 | Fresh local iTop 3.4 (46 modules, MySQL 8) |
| Live | `node scripts/api-check.mjs` | ✅ 70/70 | Includes a full incident lifecycle |
| Live | End-to-end script, every new feature | ❌ 62/65 → ✅ 65/65 | See bugs below |
| Live | Portal catalogue + knowledge base (seeded contract, service, FAQ) | ✅ | Contract scoping, foreign service refused |
| Live | Frontend in the browser against the live BFF | ✅ | Sign-in, dashboard, request page, History, resolve form, Users |
| After fixes | Backend / frontend unit tests | ✅ 345/345 · 71/71 | |

Bugs the live run found (all fixed in `905d4cf`):
1. Bulk delete deadlocked in MySQL on hierarchical classes (Organization) — deletes now run one at a time, deadlocks retried.
2. iTop's SQL and stack trace leaked into error messages — stripped.
3. History showed the change comment as the author — author now read from `user_id`.
4. Internal stimuli (Timeout, Automatic resolve) offered as buttons — only user actions offered; BFF refuses the rest.
5. "Missing mandatory attribute" returned 502 — now 400.

Not covered yet: approvals (extension not installed); load and concurrency beyond the bulk check.

## Automatic entries

- **2026-10-19 09:17 UTC** · `feature/itop-parity@905d4cf` + uncommitted changes · Unit tests (backend) · ✅ 26 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && node --import tsx --test test/oql.test.ts 2>&1 | tail -8`
- **2026-10-19 09:18 UTC** · `feature/itop-parity@905d4cf` + uncommitted changes · Live API check (BFF → iTop) (frontend) · ran — no summary line in the output
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP && python - <<'PY' p='docs/testing/TEST_LOG.md' s=open(p,encoding='utf-8').read() i=s.index('## Automatic entries') narrative = '''## Sessions ##`
- **2026-10-19 09:20 UTC** · `feature/itop-parity@73c2f26` · Live API check (BFF → iTop) · ran — no summary line in the output
  - command: `git status --short && git add .claude/settings.json .claude/hooks/record-test-run.mjs CLAUDE.md docs/testing/TEST_LOG.md && git commit -q -F - <<'EOF' Document every test run autom`
- **2026-10-19 09:53 UTC** · `feature/itop-parity@73c2f26` + uncommitted changes · Live API check (BFF → iTop) (frontend) · ✅ 3 passed, 0 failed
  - command: `T="$TEMP/claude/hooktest" && rm -rf "$T" && mkdir -p "$T" && H=.claude/hooks/record-test-run.mjs && run(){ node -e 'process.stdout.write(JSON.stringify({tool_input:{command:process`
- **2026-10-19 10:04 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/modules/dashboard/dashboard.service.ts' s=open(p,encoding='utf-8').read() def sub(old,new): global s assert old in s, old[:70] s=s.replace(old,new,1) sub('''`
- **2026-10-19 10:05 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Live API check (BFF → iTop) (backend) · ran — no summary line in the output
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && grep -n "ev_assign\|team_id\|Team" scripts/api-check.mjs | head -15; grep -n "app.post\|app.patch" src/platform/objects/objects.routes`
- **2026-10-19 10:09 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Typecheck (frontend) · ✅ clean
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend && npx prettier --write src/mocks/fixtures/dashboard.ts src/features/dashboard/components/MyAssignmentsCard.tsx src/features/dashboard/t`
- **2026-10-19 10:11 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Typecheck · ✅ clean
  - command: `cat > features/dashboard/components/MyAssignmentsCard.tsx <<'EOF' import { useMemo, useState } from 'react'; import { useNavigate } from 'react-router-dom'; import { Card, CardBody`
- **2026-10-19 10:13 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Unit tests · ✅ 4 passed, 0 failed
  - command: `cat > test/my-assignments.test.ts <<'EOF' import assert from "node:assert/strict"; import { describe, it } from "node:test"; import { DashboardService } from "../src/modules/dashbo`
- **2026-10-19 10:18 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ran — no summary line in the output
  - command: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npm run typecheck 2>&1 | tail -2; cd ../frontend && npx vitest run 2>&1 | grep -E "Tests|Test Files"; npm run build 2>&1 | tail -3`
- **2026-10-19 10:20 UTC** · `feature/itop-parity@2b3912e` + uncommitted changes · Typecheck (frontend) · ✅ clean
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend && python - <<'PY' p='src/features/dashboard/components/MyAssignmentsCard.tsx' s=open(p,encoding='utf-8').read() old=""" ? '/incidents?a`
- **2026-10-19 10:35 UTC** · `feature/itop-parity@4153270` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 5 passed, 0 failed
  - command: `cat > lib/list-cells.ts <<'EOF' import type { ClassInfo } from '../types'; /** * What a list cell shows for one attribute. * * A picker (an external key such as 'org_id') holds an `
- **2026-10-19 10:38 UTC** · `feature/itop-parity@4153270` + uncommitted changes · Frontend unit tests (vitest) · ✅ 76 passed, 0 failed
  - command: `npx vitest run 2>&1 | grep -E "Tests |Test Files"; npx tsc --noEmit -p tsconfig.app.json && echo typecheck-clean; npx eslint src/features/records 2>&1 | tail -3`
- **2026-10-19 10:47 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Typecheck · ❌ errors (see the session)
  - command: `python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) open(p,'w',encoding='utf-8').write(s) edit('sr`
- **2026-10-19 10:48 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Unit tests · ❌ 348 passed, 1 failed
  - command: `sed -i 's/ auth: { required: true, sessionIdleMs: 3_600_000, sessionMaxMs: 3_600_000, cookieSecure: false },/ auth: {\n required: true,\n sessionIdleMs: 3_600_000,\n sessionMaxMs: `
  - failed: starts an HttpOnly session and then calls iTop as that user
  - failed: sign-in
- **2026-10-19 10:49 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Unit tests · ❌ 8 passed, 1 failed
  - command: `node --import tsx --test test/auth.test.ts 2>&1 | grep -A25 "✖ starts an HttpOnly" | head -40`
  - failed: starts an HttpOnly session and then calls iTop as that user
  - failed: sign-in
- **2026-10-19 10:50 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Unit tests · ran — no summary line in the output
  - command: `sed -i 's#^import { currentCaller, enterRequestContext } from "../../core/request-context.js";#import { currentCaller, enterRequestContext, type Caller } from "../../core/request-c`
- **2026-10-19 10:51 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Unit tests · ✅ 7 passed, 0 failed
  - command: `cat > test/session-mysql.test.ts <<'EOF' import assert from "node:assert/strict"; import { describe, it } from "node:test"; import type { Caller } from "../src/core/request-context`
- **2026-10-19 10:54 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Unit tests (backend) · ✅ 356 passed, 0 failed
  - command: `python - <<'PY' p='backend/README.md' s=open(p,encoding='utf-8').read() def sub(a,b): global s assert a in s; s=s.replace(a,b,1) sub("""- **Staff call iTop as themselves.** The ses`
- **2026-10-19 10:55 UTC** · `feature/itop-parity@609c382` + uncommitted changes · Live API check (BFF → iTop) · ✅ 70 passed, 0 failed
  - command: `npm run smoke 2>&1 | tail -3; API_CHECK_LOGIN=admin API_CHECK_PASSWORD='Weftbase#2026' node scripts/api-check.mjs 2>&1 | tail -3`
- **2026-10-19 11:35 UTC** · `feature/itop-parity@d16caee` · Unit tests (backend) · ran — no summary line in the output
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && npm test 2>&1 | tail -15`
- **2026-10-19 11:37 UTC** · `feature/itop-parity@d16caee` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ran — no summary line in the output
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend && npx vitest run 2>&1 | tail -8`
- **2026-10-19 11:43 UTC** · `feature/itop-parity@d16caee` + uncommitted changes · Unit tests (backend) · ✅ 13 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) `
- **2026-10-19 11:43 UTC** · `feature/itop-parity@d16caee` + uncommitted changes · Unit tests (backend) · ✅ 3 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP && T="$TEMP/claude/hooktest2" && rm -rf "$T" && mkdir -p "$T" && run(){ node -e 'process.stdout.write(JSON.stringify({tool_input:{command:process`
- **2026-10-19 11:44 UTC** · `feature/itop-parity@d16caee` + uncommitted changes · Unit tests (backend) · ✅ 358 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npm run typecheck 2>&1 | grep -c " error "`
- **2026-10-19 11:53 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/config/env.ts' s=open(p,encoding='utf-8').read() a=" ...(passwordResetConfig() ? { passwordReset: passwordResetConfig()! } : {})," assert a in s s=s.replace(`
- **2026-10-19 11:55 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/core/errors.ts' s=open(p,encoding='utf-8').read() a=''' /** The body was not in a form this endpoint accepts. */ | "unsupported_media_type"''' assert a in s `
- **2026-10-19 11:56 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/services.ts' s=open(p,encoding='utf-8').read() def sub(a,b): global s assert a in s, a[:70]; s=s.replace(a,b,1) sub('import { MemorySessionStore, type Sessio`
- **2026-10-19 11:57 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/auth/auth.routes.ts' s=open(p,encoding='utf-8').read() def sub(a,b): global s assert a in s, a[:70]; s=s.replace(a,b,1) sub('const PUBLIC_PATHS = ne`
- **2026-10-19 11:58 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Typecheck · ✅ clean
  - command: `sed -i 's/ server: { host: "127.0.0.1", port: 0, logLevel: "silent", ...overrides.server },/ server: { host: "127.0.0.1", port: 0, logLevel: "silent", trustProxy: false, ...overrid`
- **2026-10-19 11:59 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Unit tests · ✅ 11 passed, 0 failed
  - command: `node --import tsx --test test/password-reset.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖|rror" | head -20`
- **2026-10-19 12:00 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Unit tests · ✅ 14 passed, 0 failed
  - command: `python - <<'PY' p='test/password-reset.test.ts' s=open(p,encoding='utf-8').read() s=s.replace('''import { MemorySessionStore } from "../src/platform/auth/session.store.js";''','''i`
- **2026-10-19 12:05 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 79 passed, 0 failed
  - command: `python - <<'PY' p='pages/LoginPage.tsx' lines=open(p,encoding='utf-8').read().split('\n') out=[];inside=False for l in lines: if l.startswith(' <AuthCard'): inside=True; out.append`
- **2026-10-19 12:10 UTC** · `feature/forgot-password@0d9e94a` + uncommitted changes · Unit tests (frontend) · ✅ 372 passed, 0 failed
  - command: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npm run typecheck 2>&1 | grep -c " error "; cd ../frontend && npm run build 2>&1 | tail -1`
- **2026-10-20 10:54 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck (frontend) · ✅ clean
  - command: `python - <<'PY' p='src/config/env.ts' s=open(p,encoding='utf-8').read() def sub(a,b): global s assert a in s, a[:60]; s=s.replace(a,b,1) sub(""" lookupCacheTtlMs: number; """,""" l`
- **2026-10-20 10:58 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() def sub(a,b): global s assert a in s, a[:70]; s=s.replace(a,b,1) sub('import { App`
- **2026-10-20 10:59 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `grep -n "registerUserAdminRoutes" src/app.ts; python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) `
- **2026-10-20 11:01 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() def sub(a,b): global s assert a in s, a[:70]; s=s.replace(a,b,1) sub(''' /** The a`
- **2026-10-20 11:02 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ❌ errors (see the session)
  - command: `python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) open(p,'w',encoding='utf-8').write(s) edit('sr`
- **2026-10-20 11:03 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `sed -i '164s/(named ? named\[2\] : value)/(named?.[2] ?? value)/' src/config/env.ts && sed -n 164p src/config/env.ts && npm run typecheck 2>&1 | grep error | head -3`
- **2026-10-20 11:06 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() a=s.index('export function bodyFromItop(html: string): string {') b=s.index(' cons`
- **2026-10-20 11:06 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `node -e ' const fs=require("fs");const p="src/platform/admin/notifications.service.ts";let s=fs.readFileSync(p,"utf8"); s=s.replace("\x08","\\b"); s=s.replace("/** iTop\x27s HTML b`
- **2026-10-20 11:07 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `node "C:/Users/VENKAT~1.V/AppData/Local/Temp/claude/C--Users-Venkatesh-V-Arcus-ITOP/1d0555bf-6955-416f-a464-cd91a8a0ece7/scratchpad/fix-bs.mjs" src/platform/admin/notifications.ser`
- **2026-10-20 11:10 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Unit tests · ❌ 12 passed, 1 failed
  - command: `node --import tsx --test test/notifications.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖" | head; node -e ' const {readFileSync}=require("fs");' ; grep -n "UserRequest\|Incident"`
  - failed: refuses rules it cannot send correctly
  - failed: NotificationsService
- **2026-10-20 11:10 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Unit tests · ✅ 13 passed, 0 failed
  - command: `grep -rn "CmdbSchema.fromFile(" test | head -3; python - <<'PY' p='test/notifications.test.ts' s=open(p,encoding='utf-8').read() s=s.replace('import { sampleSchema } from "./helper`
- **2026-10-20 11:15 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck · ✅ clean
  - command: `cat > features/notifications/index.ts <<'EOF' // notifications: public API. Other features may import ONLY from this file. export { NotificationListPage } from './pages/Notificatio`
- **2026-10-20 11:17 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Frontend unit tests (vitest) · ❌ 81 passed, 1 failed
  - command: `npx vitest run 2>&1 | grep -E "Tests |Test Files|FAIL|✗|×" | head`
  - failed: describeEvent > reads like a sentence, with the labels it is given 20ms
  - failed: src/features/notifications/lib/describe.test.ts > describeEvent > reads like a sentence, with the labels it is given
- **2026-10-20 11:17 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Frontend unit tests (vitest) · ran — no summary line in the output
  - command: `npx vitest run src/features/notifications 2>&1 | grep -E "Expected|Received|expected" | head -6`
- **2026-10-20 11:19 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Frontend unit tests (vitest) · ✅ 82 passed, 0 failed
  - command: `python - <<'PY' p='src/features/notifications/lib/describe.ts' s=open(p,encoding='utf-8').read() old=" const article = /^[aeiou]/i.test(what) ? 'An' : 'A';" assert old in s s=s.rep`
- **2026-10-20 11:21 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck (frontend) · ❌ errors (see the session)
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP && python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) open(p,'`
- **2026-10-20 11:21 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 3 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend && python - <<'PY' p='src/features/notifications/pages/NotificationListPage.tsx' s=open(p,encoding='utf-8').read() old=''' const { data:`
- **2026-10-20 11:24 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Typecheck (backend) · ✅ clean
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() old=''' .map((c) => ({ name: c.name,`
- **2026-10-20 11:27 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 385 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend && python - <<'PY' p='src/mocks/handlers/index.ts' s=open(p,encoding='utf-8').read() s=s.replace("import { incidentHandlers } from './in`
- **2026-10-20 11:28 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Live API check (BFF → iTop) (backend) · ✅ 13 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && npm run smoke 2>&1 | tail -2; API_CHECK_LOGIN=admin API_CHECK_PASSWORD='Weftbase#2026' node scripts/api-check.mjs 2>&1 | tail -1`
- **2026-10-20 11:28 UTC** · `feature/notifications@e3d23f3` + uncommitted changes · Live API check (BFF → iTop) · ✅ 70 passed, 0 failed
  - command: `API_CHECK_LOGIN=admin API_CHECK_PASSWORD='Weftbase#2026' node scripts/api-check.mjs 2>&1 | grep -E "passed|failed" | tail -2`
- **2026-10-20 11:38 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/conditions.ts' s=open(p,encoding='utf-8').read() old='''export function conditionsToFilter(info: ClassInfo, conditions: Criterion[], kept: str`
- **2026-10-20 11:39 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() def sub(a,b,count=1): global s assert a in s, a[:80]; s=s.replace(a,b,count) sub('`
- **2026-10-20 11:40 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() def sub(a,b,count=1): global s assert a in s, a[:80]; s=s.replace(a,b,count) sub('`
- **2026-10-20 11:41 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.routes.ts' s=open(p,encoding='utf-8').read() s=s.replace('import { EDITABLE_EVENTS, type RuleInput } from "./notifications.servi`
- **2026-10-20 11:43 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Unit tests · ✅ 6 passed, 0 failed
  - command: `node --import tsx --test test/notification-conditions.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖|Expected|actual|expected|\+ |\- " | head -30`
- **2026-10-20 11:45 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck (frontend) · ✅ clean
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend/src/features/records/components && python - <<'PY' p='AdvancedSearch.tsx' s=open(p,encoding='utf-8').read() def sub(a,b): global s asser`
- **2026-10-20 11:47 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck (frontend) · ❌ errors (see the session)
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend/src/features && python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:80]); s=s.r`
- **2026-10-20 11:49 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Frontend unit tests (vitest) · ✅ 82 passed, 0 failed
  - command: `python - <<'PY' p='src/features/notifications/lib/describe.ts' s=open(p,encoding='utf-8').read() old='''export function describeEvent( event: RuleEvent,''' assert old in s s=s.repl`
- **2026-10-20 11:50 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Typecheck · ✅ clean
  - command: `sed -i 's/{ kind, recordType, ...(state ? { state } : {}), fields, sla: { timer, percent }, hasCondition: false, firesFromPlatform: true },/{ kind, recordType, ...(state ? { state `
- **2026-10-20 11:55 UTC** · `feature/notification-conditions@f051354` + uncommitted changes · Frontend unit tests (vitest) (backend) · ✅ 391 passed, 0 failed
  - command: `npx vitest run 2>&1 | grep -E "Tests |Test Files"; npm run build 2>&1 | tail -1; cd ../backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npm run typecheck 2>&1 | grep -c "`
- **2026-10-20 12:03 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Typecheck (backend) · ✅ clean
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && python - <<'PY' import re def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.repla`
- **2026-10-20 12:05 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests · ❌ 3 passed, 1 failed
  - command: `node --import tsx --test test/inbox.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖" | head`
  - failed: lists only the caller's own notifications, newest first, as plain text
  - failed: InboxService
- **2026-10-20 12:05 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests · ran — no summary line in the output
  - command: `node --import tsx --test test/inbox.test.ts 2>&1 | grep -A12 "✖ lists only" | grep -E "Expected|actual|expected|\+|\-|Error" | head -12`
- **2026-10-20 12:05 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests · ran — no summary line in the output
  - command: `sed -i 's|const id = /id = (\\d+)\$/.exec(oql)?.\[1\];|const id = / AND id = (\\d+)$/.exec(oql)?.[1];|' test/inbox.test.ts && grep -n "AND id = " test/inbox.test.ts && node --impor`
- **2026-10-20 12:06 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests · ✅ 4 passed, 0 failed
  - command: `node --import tsx --test test/inbox.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
- **2026-10-20 12:08 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) open(p,'w',encoding='utf-8').write(s) edit('co`
- **2026-10-20 12:09 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 83 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend/src && cat > mocks/handlers/inbox.ts <<'EOF' import { http, HttpResponse } from 'msw'; import { env } from '@/config/env'; const url = (`
- **2026-10-20 12:12 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Typecheck (backend) · ❌ errors (see the session)
  - command: `python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:70]); s=s.replace(a,b,1) open(p,'w',encoding='utf-8').write(s) edit('sr`
- **2026-10-20 12:13 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests · ✅ 5 passed, 0 failed
  - command: `cat >> src/shared/itop-time.ts <<'EOF' /** An instant as iTop's "YYYY-MM-DD HH:MM:SS" in 'timeZone', for writing dates iTop will read. */ export function toItopTime(instant: Date, `
- **2026-10-20 12:16 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Typecheck · ✅ clean
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() def sub(a,b,count=1): global s assert a in s, a[:80]; s=s.replace(a,b,count) # Typ`
- **2026-10-20 12:17 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests (backend) · ✅ 13 passed, 0 failed
  - command: `python - <<'PY' p='src/platform/admin/notifications.service.ts' s=open(p,encoding='utf-8').read() old_start=s.index(' if (editableEvent) {\n if (TRIGGER_CLASS[effective.event.kind]`
- **2026-10-20 12:20 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 83 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/frontend/src && python - <<'PY' def edit(p, pairs): s=open(p,encoding='utf-8').read() for a,b in pairs: assert a in s, (p,a[:80]); s=s.replace(a,`
- **2026-10-20 12:21 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Unit tests (backend) · ✅ 14 passed, 0 failed
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/backend && python - <<'PY' p='test/notifications.test.ts' s=open(p,encoding='utf-8').read() anchor=''' it("refuses rules it cannot send correctly`
- **2026-10-20 12:23 UTC** · `feature/bell-notifications@6098932` + uncommitted changes · Live API check (BFF → iTop) (frontend) · ✅ 397 passed, 0 failed
  - command: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npm run typecheck 2>&1 | grep -c " error "; npm run smoke 2>&1 | grep -E "passed"; API_CHECK_LOGIN=admin API_CHECK_PASSWORD='Weftbas`
- **2026-10-20 12:40 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Typecheck (backend) · ✅ clean
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; python - <<'EOF' p='src/modules/incidents/incidents.service.ts' s=open(p,encoding='utf-8').read() old=''' if (input.startDate) { // date`
- **2026-10-20 12:41 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ran — no summary line in the output
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; grep -n '"test"' package.json; npm test 2>&1 | grep -E "^not ok|^# |fail|✖|Error" | head -40`
- **2026-10-20 12:44 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ✅ 13 passed, 0 failed
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; node --import tsx --test test/itop-time-paths.test.ts 2>&1 | grep -vE "^\s+✔" | head -60`
- **2026-10-20 12:45 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ran — no summary line in the output
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; python - <<'EOF' p='test/itop-time-paths.test.ts' s=open(p,encoding='utf-8').read() s=s.replace(''' public_log: { type: "CaseLog", ui: "`
- **2026-10-20 12:51 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (frontend) · ⏳ started in the background — result not captured here; see the session entry
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/.worktrees/ci/backend && (npm ci --no-audit --no-fund 2>&1 | tail -1) && npm run typecheck 2>&1 | tail -1 && npm test 2>&1 | grep -E "^ℹ (tests|p`
- **2026-10-20 12:53 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ran — no summary line in the output
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/frontend; cat > src/lib/utils/format.test.ts <<'EOF' import { describe, expect, it } from 'vitest'; import { dateTimeText, fromDateTimeInput, isI`
- **2026-10-20 12:56 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live API check (BFF → iTop) (backend) · ✅ 410 passed, 0 failed
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; grep -n '"typecheck\|"build\|"smoke\|"api:check' package.json; npx tsc --noEmit -p . && echo TYPECHECK_OK; npm test 2>&1 | grep -E "^ℹ (`
- **2026-10-20 12:58 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ⏳ started in the background — result not captured here; see the session entry
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/frontend; npx tsc -b --noEmit 2>&1 | tail -20 && echo TC_DONE; npx vitest run 2>&1 | tail -8`
- **2026-10-20 13:03 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live API check (BFF → iTop) (backend) · ran — no summary line in the output
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; npm run build 2>&1 | tail -5; cat backend/README.md 2>/dev/null | head -0; grep -n "smoke\|api:check\|api-check" README.md | head; docke`
- **2026-10-20 13:09 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live smoke test (BFF → iTop) (backend) · ✅ 13 passed, 0 failed
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; grep -n '"dev"' package.json; npm run smoke 2>&1 | tail -25`
- **2026-10-20 13:10 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live API check (BFF → iTop) (backend) · ✅ 87 passed, 0 failed
  - command: `cat "C:/Users/VENKAT~1.V/AppData/Local/Temp/claude/C--Users-Venkatesh-V-Arcus-ITOP/17187cdd-e0d6-45d4-a8aa-8539d518291e/tasks/bkk1mythd.output"; cd C:/Users/Venkatesh.V/Arcus_ITOP/`
- **2026-10-20 13:18 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ran — no summary line in the output
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/backend"; python - <<'EOF' p='test/transfer.test.ts' s=open(p,encoding='utf8').read() old=s[s.index(' for`
- **2026-10-20 13:19 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live API check (BFF → iTop) (backend) · ❌ 69 passed, 1 failed
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; API_CHECK_LOGIN=admin API_CHECK_PASSWORD='Weftbase#2026' node scripts/api-check.mjs 2>&1 | grep -vE "^\s+ok " | tail -25`
  - failed: GET   /api/incidents?limit=2&page=2              502  expected 200, got 502 — {"error":{"code":"upstream_error","message":"iTop return
- **2026-10-20 13:23 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live API check (BFF → iTop) (backend) · ✅ 70 passed, 0 failed
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP; grep -n "list paged\|69 passed\|70 passed\|HTTP 500" docs/testing/TEST_LOG.md | tail -8; cd backend; API_CHECK_LOGIN=admin API_CHECK_PASSWORD='W`
- **2026-10-20 13:25 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ran — no summary line in the output
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/backend"; head -85 test/transfer.test.ts > /tmp/head.ts; cat > /tmp/tail.ts <<'EOF' describe("CSV for the`
- **2026-10-20 13:25 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Live API check (BFF → iTop) (backend) · ran — no summary line in the output
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/backend; sed -n 100,140p scripts/api-check.mjs`
- **2026-10-20 13:26 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Typecheck (backend) · ✅ clean
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/xenodochial-merkle-a3288c/backend" && cat "C:\Users\VENKAT~1.V\AppData\Local\Temp\claude\C--Users-Venkatesh-V-Arcus-ITOP--clau`
- **2026-10-20 13:27 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ran — no summary line in the output
  - command: `cd /c/Users/Venkatesh.V/Arcus_ITOP/.worktrees/ci/frontend && npx vitest run 2>&1 | grep -E "FAIL|×|AssertionError|Expected|Received|Error:" | head -15`
- **2026-10-20 13:28 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ran — no summary line in the output
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/xenodochial-merkle-a3288c/backend" && node --import tsx --test test/audit.test.ts 2>&1 | grep -E "^not ok|^# (pass|fail)|Error`
- **2026-10-20 13:28 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ✅ 13 passed, 0 failed
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/xenodochial-merkle-a3288c/backend" && node --import tsx --test test/audit.test.ts 2>&1 | tail -25`
- **2026-10-20 13:30 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) · ✅ 83 passed, 0 failed
  - command: `npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✓|×|FAIL|Test Files|Tests " | head -30`
- **2026-10-20 13:30 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Typecheck (frontend) · ✅ clean
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/frontend"; f=src/features/records/pages/RecordImportPage.tsx; sed -i 's/^ actions={$/ action={/' $f; grep`
- **2026-10-20 13:31 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) · ran — no summary line in the output
  - command: `ls vite.config.* vitest.config.* 2>/dev/null; grep -n "test:" -A12 vite.config.ts 2>/dev/null | head -20`
- **2026-10-20 13:34 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Production build (frontend) · ✅ clean
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP/frontend; npm run build 2>&1 | tail -6`
- **2026-10-20 13:36 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Typecheck (frontend) · ✅ clean
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/frontend/src/features/records"; python - <<'PYEOF' def edit(p, pairs): s=open(p,encoding='utf8').read() f`
- **2026-10-20 13:36 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ran — no summary line in the output
  - command: `cd C:/Users/Venkatesh.V/Arcus_ITOP; git branch --show-current; git status --short | wc -l; cd backend && node --import tsx --test test/itop-time-paths.test.ts 2>&1 | grep -E "^ℹ (p`
- **2026-10-20 13:38 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 35 passed, 0 failed
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/frontend"; npx vitest run src/features/records 2>&1 | tail -25`
- **2026-10-20 13:38 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ran — no summary line in the output
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/xenodochial-merkle-a3288c/frontend" && head -5 src/features/notifications/lib/describe.test.ts; cat > src/features/audit/lib/r`
- **2026-10-20 13:38 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ⏳ started in the background — result not captured here; see the session entry
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/backend"; npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖" | head -20; npm run typecheck 2>&1 | tail -3`
- **2026-10-20 13:39 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ⏳ started in the background — result not captured here; see the session entry
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/frontend"; npx vitest run 2>&1 | tail -6; npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -5; echo TSC_`
- **2026-10-20 13:42 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Unit tests (backend) · ⏳ started in the background — result not captured here; see the session entry
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/xenodochial-merkle-a3288c/backend" && npm test 2>&1 | tail -12`
- **2026-10-20 13:50 UTC** · `feature/bell-notifications@f841e4a` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 10 passed, 0 failed
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845/frontend"; npx vitest run src/features/records/lib/import-mapping.test.ts 2>&1 | tail -15; cat "C:/Users/`
- **2026-10-20 13:56 UTC** · `feature/itop-dates@780553e` + uncommitted changes · Frontend unit tests (vitest) (frontend) · ✅ 36 passed, 0 failed
  - command: `cd "C:/Users/Venkatesh.V/Arcus_ITOP/.claude/worktrees/funny-maxwell-1ae845"; grep -n "friendly name" frontend/src/features/records/lib/import-mapping.ts; (cd backend && node --impo`
- **2026-10-22 17:20 UTC** · `claude/multi-tenancy-efcab8@f5b5c70` + uncommitted changes · Unit tests (backend) · ✅ 556 passed, 0 failed (added by hand: the hook logged to the main checkout)
  - command: `npm test`
- **2026-10-22 17:21 UTC** · `claude/multi-tenancy-efcab8@f5b5c70` + uncommitted changes · Typecheck + build (backend) · ✅ (added by hand)
  - command: `npm run typecheck; npm run build`
- **2026-10-22 17:10 UTC** · `claude/multi-tenancy-efcab8@f5b5c70` + uncommitted changes · Live end-to-end script (backend) · ✅ 143 passed, 0 failed (added by hand)
  - command: `PLATFORM_LOGIN=admin PLATFORM_PASSWORD=… node scripts/e2e-tenancy.mjs`
- **2026-10-23 05:50 UTC** · `claude/requests-c8e01b@2d47fa2` + uncommitted changes · Unit tests (backend) · ✅ 569 passed, 0 failed (added by hand: the hook logged to the main checkout)
  - command: `npm test`
- **2026-10-23 05:52 UTC** · `claude/requests-c8e01b@2d47fa2` + uncommitted changes · Live end-to-end script (backend) · ✅ 16 passed, 0 failed (added by hand)
  - command: `E2E_STAFF_PASSWORD=… npm run e2e:requests`
- **2026-10-23 06:00 UTC** · `claude/requests-c8e01b@2d47fa2` + uncommitted changes · Frontend unit tests (vitest) + typecheck (frontend) · ✅ 163 passed, 0 failed (added by hand)
  - command: `npx tsc -p tsconfig.app.json --noEmit; npx vitest run`
- **2026-10-23 06:20 UTC** · `claude/requests-c8e01b@2d47fa2` + uncommitted changes · Playwright mock journeys (frontend) · ✅ 4 passed, 0 failed (added by hand)
  - command: `E2E_MOCK_URL=http://localhost:5714 npx playwright test request-forms portal --workers=1`
- **2026-10-23 07:10 UTC** · `claude/requests-c8e01b@1c16737` (after merging main with approvals) · Unit tests + typecheck (backend) · ✅ 582 passed, 0 failed (added by hand)
  - command: `npm run typecheck; npm test`
- **2026-10-23 07:15 UTC** · `claude/requests-c8e01b@1c16737` · Frontend typecheck + vitest (frontend) · ✅ 170 passed, 0 failed (added by hand)
  - command: `npx tsc -p tsconfig.app.json --noEmit; npx vitest run`
- **2026-10-23 07:20 UTC** · `claude/requests-c8e01b@1c16737` · Playwright mock journeys (frontend) · ✅ 4 passed, 0 failed (added by hand)
  - command: `E2E_MOCK_URL=http://localhost:5714 npx playwright test request-forms portal approvals --workers=1`
