# PMK-309: keep npm test output in TAP when piped

Status: approved by the orchestrator brief (autonomous run, no questions asked).
Issue: PMK-309, parent EPC-6.

## Intent

`npm test` runs `scripts/run-tests.mjs`, which spawns `node --test` with no
reporter. Node 22 prints TAP when stdout is not a terminal; Node 26 prints
the spec reporter there. Agents and the orchestration read `# tests`,
`# pass` and `# fail` from a piped `npm test`, so on Node 26 they find
nothing. The runner should ask for the TAP reporter when stdout is not a
terminal, and leave the reporter alone in a terminal.

## Goals

- A piped `npm test` ends with `# tests`, `# pass`, `# fail` on Node 22 and Node 26.
- In a terminal the reporter is not forced (Node's default stays).
- The arguments are built by an exported function so a test can check both cases.

## Non-goals

- Changing what the tests check.
- Changing the leak guard (`findLeaks`, `finish`) or `childEnv`.
- Touching the PMK-301 child runs that already pass `--test-reporter=tap`
  (`scripts/lib/linear/sandbox.test.mjs`, `degraded-live.test.mjs`,
  `migrate-live.test.mjs`).

## Approaches

1. **Chosen:** an exported `testArgs(isTTY)` in `run-tests.mjs` that returns
   `['--test', ...(isTTY ? [] : ['--test-reporter=tap']), 'scripts/**/*.test.mjs']`.
   The entry block calls it with `process.stdout.isTTY === true`. Tested with
   `true` and `false`. Smallest change; same shape as the other exported helpers.
2. Always pass `--test-reporter=tap`. Rejected: the issue says the reporter
   must not be forced in a terminal.
3. Set `NODE_OPTIONS` or an env var for the child. Rejected: harder to test
   and it leaks into the child tests' own environment.

## Design

- `testArgs(isTTY)` is pure and exported next to `findLeaks`, `childEnv`
  and `finish`.
- The entry block (`process.argv[1] === ...`) uses `testArgs(process.stdout.isTTY === true)`
  in place of the inline array. `stdio: 'inherit'` and the leak guard stay as they are.
- `scripts/run-tests.test.mjs` gets two tests: a piped call contains
  `--test-reporter=tap`, a terminal call does not, and both keep the glob.

## Calls made without asking

- `isTTY` is coerced with `=== true` so `undefined` (non-TTY streams) counts as piped.
- The reporter flag sits between `--test` and the glob, the same order as today.
- The Node 26 proof is a manual run in the PR body; no new automated test
  depends on a second Node binary.

## Left to the builder

- Exact test names, as long as both cases are covered.
