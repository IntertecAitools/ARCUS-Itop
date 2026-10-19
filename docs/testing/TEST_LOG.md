# Test log

Every test run, newest last. Entries are appended automatically by `.claude/hooks/record-test-run.mjs`; narrative notes (what was tested, bugs found) are added by hand under a dated heading.

## Sessions

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
