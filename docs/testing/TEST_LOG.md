# Test log

Every test run, newest last. Entries are appended automatically by `.claude/hooks/record-test-run.mjs`; narrative notes (what was tested, bugs found) are added by hand under a dated heading.

## Sessions

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
