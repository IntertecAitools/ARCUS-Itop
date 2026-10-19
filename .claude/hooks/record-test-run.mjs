#!/usr/bin/env node
/**
 * PostToolUse hook: records every test run Claude makes in this repository.
 *
 * Reads the hook payload on stdin (the shell command and its output), and when
 * the command is a test, typecheck, build or live check, appends one entry to
 * docs/testing/TEST_LOG.md: when, branch@commit, what ran, the pass/fail
 * counts it printed, and the names of failing tests. Anything else is ignored.
 *
 * It never blocks or fails the tool call: every error is swallowed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/** What counts as a check, and how to label it. First match wins. */
const KINDS = [
  { re: /api-check\.mjs|api:check/, label: 'Live API check (BFF → iTop)' },
  { re: /scripts\/smoke|npm run smoke/, label: 'Live smoke test (BFF → iTop)' },
  { re: /\be2e[\w-]*\.mjs\b/, label: 'Live end-to-end script' },
  { re: /\bvitest\b/, label: 'Frontend unit tests (vitest)' },
  { re: /--import tsx --test|\bnpm (run )?test\b/, label: 'Unit tests' },
  { re: /\bnpm run typecheck\b|\btsc\b[^|;&]*--noEmit/, label: 'Typecheck' },
  { re: /\bnpm run build\b/, label: 'Production build' },
];

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (typeof value === 'object') return Object.values(value).map(textOf).join('\n');
  return String(value);
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** The counts the runner printed, in whichever runner's format. */
function summarise(out) {
  const node = {
    tests: /ℹ tests (\d+)/.exec(out)?.[1],
    pass: /ℹ pass (\d+)/.exec(out)?.[1],
    fail: /ℹ fail (\d+)/.exec(out)?.[1],
  };
  if (node.tests) return { passed: Number(node.pass ?? 0), failed: Number(node.fail ?? 0) };

  const vitest = /Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/.exec(out);
  if (vitest) return { passed: Number(vitest[2]), failed: Number(vitest[1] ?? 0) };

  const script = [...out.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  if (script) return { passed: Number(script[1]), failed: Number(script[2]) };

  return null;
}

function failingNames(out) {
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(?:✖|FAIL|×)\s+(.+?)\s*(?:\(\d[\d.]*m?s\))?\s*$/.exec(line);
    if (m && !/failing tests:|^test at /.test(m[1]) && !names.includes(m[1])) names.push(m[1].slice(0, 160));
  }
  return names.slice(0, 15);
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const command = String(input.tool_input?.command ?? '');
  const kind = KINDS.find((k) => k.re.test(command));
  if (!kind) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const out = stripAnsi(textOf(input.tool_response));
  const summary = summarise(out);
  const failures = failingNames(out);

  let result;
  if (summary) {
    result = `${summary.failed === 0 ? '✅' : '❌'} ${summary.passed} passed, ${summary.failed} failed`;
  } else if (/Typecheck|build/i.test(kind.label)) {
    const broke = /error TS\d+|Build failed|ERROR/.test(out);
    result = broke ? '❌ errors (see the session)' : '✅ clean';
  } else {
    result = 'ran — no summary line in the output';
  }

  const area = /\bfrontend\b/.test(command) ? 'frontend' : /\bbackend\b/.test(command) ? 'backend' : '';
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = git(root, ['rev-parse', '--short', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain']) ? ' + uncommitted changes' : '';
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const shown = command.replace(/\s+/g, ' ').slice(0, 180);

  const file = join(root, 'docs', 'testing', 'TEST_LOG.md');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      '# Test log\n\nEvery test run, newest last. Entries are appended automatically by ' +
        '`.claude/hooks/record-test-run.mjs`; narrative notes (what was tested, bugs found) ' +
        'are added by hand under a dated heading.\n\n## Automatic entries\n\n',
    );
  }

  const lines = [
    `- **${when}** · \`${branch}@${commit}\`${dirty} · ${kind.label}${area ? ` (${area})` : ''} · ${result}`,
    `  - command: \`${shown.replace(/`/g, "'")}\``,
    ...failures.map((f) => `  - failed: ${f}`),
  ];
  appendFileSync(file, `${lines.join('\n')}\n`);
} catch {
  // Recording must never get in the way of the work.
}
process.exit(0);
