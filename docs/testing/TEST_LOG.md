# Test log

Every test run, newest last. Entries are appended automatically by `.claude/hooks/record-test-run.mjs`; narrative notes (what was tested, bugs found) are added by hand under a dated heading.

## Sessions

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
