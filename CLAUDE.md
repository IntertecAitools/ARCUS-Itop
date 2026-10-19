# Working in this repository

Start with `README.md` (layout, the module rules) and `backend/README.md` (the BFF, sign-in, local iTop).

## Testing is always documented

Every test run must leave a record in `docs/testing/TEST_LOG.md`.

- **Automatic:** `.claude/hooks/record-test-run.mjs` (a PostToolUse hook in `.claude/settings.json`) appends one entry per run of unit tests, vitest, typecheck, build, `npm run smoke`, `api:check` and `e2e*.mjs` scripts — time, branch@commit, counts, failing test names. Never delete or rewrite these entries; the section must stay last in the file, since the hook appends to the end.
- **By hand, at the end of any session that tested something:** add a dated `###` entry under `## Sessions` (newest first) with a short table of what ran and the result, the bugs found and how they were fixed (with the commit), and anything not covered. Do this even when everything passed.
- When a test runs outside Claude (CI, a person), add it by hand too.

## Local iTop

A local iTop 3.4 runs in Docker (`docker/docker-compose.local.yml`, port 8080, database `itop_prod`). Setup steps: `backend/README.md`, "Local iTop".
