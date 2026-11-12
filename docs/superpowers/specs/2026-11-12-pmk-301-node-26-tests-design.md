# PMK-301: pass the test suite under Node 26 — design

Status: approved by the orchestrator's brief (autonomous run; the calls below are the implementer's, not user-agreed).

## Intent

`npm test` passes on Node 22.22.0 and fails with 3 tests on Node 26.4.0. Node 26 changed two things the tests depend on: the default reporter when stdout is not a TTY (spec instead of TAP), and the error code `rmSync` gives on a read-only folder (`ENOTEMPTY` instead of `EACCES`). The product code is right in both cases; only the tests assume the old behaviour.

## Goals

- `npm test` exits 0 under Node 22 and under Node 26.
- The delete test still proves that a failed cleanup is reported to the user.

## Non-goals

- A CI matrix for Node versions.
- Any change to product code under `scripts/` outside test files.

## Anti-goals

- Making the tests pass by deleting or weakening the assertion that the cleanup failure is reported.
- Parsing reporter output in a way that depends on the Node version's default.

## Constraints

- Node 26 accepts `--test-reporter=tap` both with `--test` and on a plain `node <file>` run (checked locally: the entry prints `# skipped 1` and `# SKIP ...`).
- `scripts/lib/linear/migrate-live.test.mjs:439` already passes `--test-reporter=tap`; this is the existing pattern.

## Approaches

1. **Pin the reporter in every child spawn that reads output.** Add `--test-reporter=tap` to the spawns that parse TAP. Small, explicit, same pattern as `migrate-live.test.mjs`. Chosen.
2. Parse both formats (`# skipped` and `ℹ skipped`). Works, but every reader must know about every reporter; it hides the default change instead of pinning it.
3. Set `NODE_OPTIONS` or a reporter env var for the whole run. Not available as a single env var for the reporter, and it would also change `scripts/run-tests.mjs` for the parent run.

## Parts

- `scripts/lib/linear/degraded-live.test.mjs` (spawn at line 14): add `--test-reporter=tap` before the script path.
- `scripts/lib/linear/sandbox.test.mjs` (`spawnEntry`, line ~745): add `--test-reporter=tap` before the entry path. The entry runs under plain `node`, which the flag also accepts.
- `scripts/tracker-delete.test.mjs:200`: the cleanup-failure assertion accepts the code the running Node gives, `/could not be removed: (EACCES|ENOTEMPTY)/`. The assertion that the message is reported and that the issue is gone stays as it is.
- Any other test that reads the output of a child `node --test` run: checked with grep (`# skipped`, `# SKIP`, `# pass`, `ℹ`); only the two above and `migrate-live.test.mjs` (already TAP) read it.

## Left to the builder (the implementer's calls)

- Whether the delete test should check the error code exactly per Node version (rejected: the brief says to accept the code each version gives).
- Node 22 with `--test-reporter` on a plain run: verified by running `npm test` under Node 22.

## Proof

- `npm test` in the foreground under `/opt/homebrew/bin/node` (Node 26.4.0) and `/opt/homebrew/opt/node@26/bin/node`, plus Node 22.22.0, exit code 0. Counts go in the PR.
