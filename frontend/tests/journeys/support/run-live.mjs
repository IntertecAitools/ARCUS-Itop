// `npm run e2e:live [-- playwright args]`: the journeys against the live stack.
// A script rather than `E2E_TARGET=live playwright test`, which Windows shells cannot run.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- developer tool; Windows needs a shell to run npx, and the arguments are the developer's own
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_TARGET: 'live' },
});
process.exit(result.status ?? 1);
