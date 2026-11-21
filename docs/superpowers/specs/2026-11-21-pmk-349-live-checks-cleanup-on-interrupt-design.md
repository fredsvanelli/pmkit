# PMK-349: clean up after the writing GitHub live checks when a run is interrupted

Issue: PMK-349 (EPC-8, task). Related: PMK-335 (PR #327, `docs/specs/2026-11-18-pmk-335-github-live-checks-design.md`), PMK-351 (the first real run).

## Intent

The writing live checks (`checkOpenCycle`, `checkGhesConversion` in `scripts/lib/github/live-checks.mjs`) add drafts to a throwaway Project, add a sprint iteration, and on GHES convert a draft into an issue. `withCleanup` removes all of it after the check, pass or fail, but a run stopped with Ctrl-C never reaches the cleanup, and the next run refuses the non-empty Project until someone follows the runbook's manual steps. Make SIGINT and SIGTERM run the same cleanup and say what it removed and what it left.

## Goals, non-goals, anti-goals

- Goal: SIGINT or SIGTERM during a writing check runs that check's pending cleanup (delete the drafts it added, restore the iteration list, remove the converted issue), then exits non-zero (130 for SIGINT, 143 for SIGTERM).
- Goal: the run prints one line per cleanup step: what it removed, or what it could not remove with the item's URL (the Project's URL and the item id for a draft, the Project's field settings URL for the iteration, the issue URL) and the runbook step to remove it by hand.
- Non-goal (issue): the read-only checks; SIGKILL.
- Anti-goal: a cleanup that deletes anything the run did not add (the `guardExec` allow-list keeps holding), or a second signal that starts a second cleanup in parallel.

## Approaches

1. **A registry of pending cleanups in `live-checks.mjs`, drained by signal handlers in `client-live.mjs` (chosen).** `withCleanup` adds its `cleanup` to a module-level set while its body runs and removes it once the cleanup ran. An exported `cleanUpPending(write)` runs every pending cleanup once and returns the failures. `client-live.mjs` installs `process.once('SIGINT')` and `process.once('SIGTERM')` handlers that call it with a writer to stderr (the test runner's diagnostics are not flushed on exit), then `process.exit(130|143)`. A second signal while it runs is ignored (the `once` handlers are gone, and a flag stops a re-entry).
2. **`AbortSignal` threaded through every request so the body stops and `withCleanup` runs normally.** Cleaner shutdown, but every `client.request` and `paginate` would take a signal, which the client does not support today. Rejected: more change than the issue needs.
3. **A separate "sweep" command that deletes every `pmkit-live` draft from the Project.** Covers drafts only; the iteration and the GHES issue still need the check's own state. Kept as the manual runbook step, not code.

## Design

- `scripts/lib/github/live-checks.mjs`: the registry; `withCleanup` registers and unregisters; each cleanup step writes what it removed (`deleted the draft <id>`, `restored the <n> iterations of <field>`, `deleted issue #<n>`) and its failure line names the URL and the runbook step ("Clean up after a stopped run", step 1, 2 or 3). `preflightProject` already reads the Project; it also returns its `url` for those lines.
- `scripts/lib/github/client-live.mjs`: the two handlers.
- A draft whose add was in flight at the signal has no id yet; the closing line says to check the Project for `pmkit-live` drafts (runbook step 1).
- Runbook `docs/runbooks/live-checks-github.md`: "Clean up after a stopped run" says Ctrl-C now cleans up, shows the lines to expect, and keeps the manual steps for SIGKILL, a lost connection and a failed cleanup line.

## Tests

- Unit (`live-checks.test.mjs`, against the stateful fake through `guardExec`): `cleanUpPending` during a paused `checkOpenCycle` body deletes the drafts and restores the iterations, and a second call does nothing; a failing delete reports the URL and the runbook step.
- E2E (`scripts/runbook-live-checks-github.test.mjs`): the live entry runs as a child with `PMKIT_LIVE=1` and the fake `gh` on PATH; the fake `gh` blocks on the first `PmkitUpdateIterations` until the test sends SIGINT; the child exits 130, prints the cleanup lines, and the fixture's throwaway Project ends empty with its original iterations. Whether the child is `node --test <file>` or `node <file>` is settled by this test: if the `--test` runner kills its file subprocess before the handler finishes, the runbook says to run the file with `node <file>` and the test proves that.

## Left to the builder

Names; the exact cleanup lines.

## As built (Execute and Secure, 2026-11-21)

Probes in a scratch folder changed approach 1 in two places, and the review dropped its registry:

- gh runs synchronously (`spawnSync`), so Ctrl-C lands during a gh call. It ends that call, and a `process.on('SIGINT')` handler runs only at a later event-loop turn, which node:test may never give before the run ends. The entry therefore treats a gh call ended by SIGINT or SIGTERM (`defaultExec` now returns the call's `signal`) as the stop. The check fails, its own `withCleanup` cleans up and prints each step, and the run exits 130 or 143 before the next check. The handlers stay for a signal that arrives between checks.
- With that, the registry of pending cleanups (`cleanUpPending`) had no caller that could find anything pending, so ponytail-review removed it.
- Under `node --test`, the runner exits on Ctrl-C and leaves the file's process to clean up with no output to write to. The runbook runs the entry with plain `node`.
- Lines go to stderr with `fs.writeSync`, because on macOS a pipe is asynchronous and `process.exit` drops what it has not written.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf: the issue's acceptance criteria and this design, with no open product question. The questions the grilling raised and the answers taken (the recommended ones):

- Exit code after an interrupted cleanup: 130 for SIGINT and 143 for SIGTERM, so a script sees the run did not pass.
- A second Ctrl-C during the cleanup: ignored; the cleanup finishes. A user who must stop now has SIGKILL and the manual steps.
- No new term for `CONTEXT.md` (live check and throwaway Project are test vocabulary, not domain terms) and no ADR (easy to reverse).
