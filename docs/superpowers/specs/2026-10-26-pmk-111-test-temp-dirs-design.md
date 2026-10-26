# PMK-111: tests leave temp directories behind

## Problem

`npm test` leaves about 300 `pmkit-*` folders in the temp folder. The temp folder on this machine is a tmpfs that has run out of inodes twice. Acceptance criteria:

1. Every test that makes a temp directory removes it when the test ends, pass or fail.
2. `npm test` leaves no `pmkit-*` directory in the temp folder.

## Findings

Measured on `main` by running each test file alone (`node --test scripts/<file>` and counting `/tmp/pmkit-*` before and after). Files not listed leave nothing, including `goldens.test.mjs`, `golden-helpers.test.mjs`, `scenarios.test.mjs`, `scenario-helpers.test.mjs`, `test-helpers.test.mjs`, `query-index.test.mjs` and `cli-autocommit.test.mjs`, which already use `try/finally`.

| Test file | Folders left | Source |
| --- | --- | --- |
| cli.test.mjs | 62 | `makeRepo`, 63 call sites, plus `pmkit-init-` and `pmkit-body-` by hand |
| cli-pr.test.mjs | 44 | `scratch()` and `fakeGh` without `dir` |
| sprints.test.mjs | 41 | `makeRepo` |
| tracker-issues.test.mjs | 28 | `makeRepo` |
| query.test.mjs | 25 | `makeRepo` |
| migrations.test.mjs | 23 | `makeRepo` |
| epics, tracker-milestones | 18 each | `makeRepo` |
| validate.test.mjs | 16 | `makeRepo` |
| cli-init.test.mjs | 14 | own `tmp()` |
| tracker-relations | 14 | `makeRepo` |
| config.test.mjs | 11 | own `tmp()` |
| tracker-comments | 10 | `makeRepo` |
| capabilities, documents | 8 each | `makeRepo` |
| events.test.mjs | 5 | own `tmp()` |
| metrics.test.mjs | 2 | `makeRepo` |

The per-file counts add up to about 347 folders per full run. The orchestrator measured 301 on its machine, so a few tests vary with the environment.

Where directories are created:

- `scripts/test-helpers.mjs`: `makeRepo` (prefix `pmkit-`). It is the biggest source, with 158 call sites across 21 files.
- `scripts/fake-gh.mjs`: `fakeGh(canned, dir = scratch())` creates a `pmkit-pr-` folder when the caller passes no `dir`.
- Hand-written `mkdtempSync` in `cli.test.mjs`, `cli-init.test.mjs`, `cli-pr.test.mjs`, `config.test.mjs`, `events.test.mjs`, `query-index.test.mjs`, `golden-helpers.test.mjs`, `scenario-helpers.test.mjs` and `test-helpers.test.mjs`.
- `scenario-helpers.mjs` `runScenario` makes `pmkit-scn-` and removes it in a `finally`. `scenarios-live.mjs` is not part of `npm test`.
- `scripts/lib/local/migrations.mjs` `planMigration` makes `pmkit-format-` in production code and registers it with `removeOnExit`. It is already clean and stays unchanged.

`node --test` runs each file in its own process, in parallel across files and in sequence inside a file. Root-level `afterEach` hooks run after passing and failing tests (checked on Node 22).

## Options

A. `try/finally` in every test. It meets criterion 1 literally, but it touches about 160 call sites, adds an indent level to each test, and the next new test can forget it. Helpers such as `fakeGh` still need a way to hand back the folder.

B. A registry in `test-helpers.mjs`. `tempDir(prefix)` makes the folder and records it. A root-level `afterEach` registered when the module loads removes every folder recorded during the test, and an `exit` listener removes anything still recorded (for top-level code outside a test). `makeRepo` and `fakeGh` call `tempDir`, so most tests change nothing.

C. Helpers return a cleanup function (`const { root, cleanup } = makeRepo()`). The call sites change shape in 158 places and a test can still forget `cleanup`.

## Decisions

| Decision | Reason |
| --- | --- |
| Use option B. | The 21 files that call `makeRepo` need no edit, and the new test cannot forget cleanup because the helper owns it. A and C need a change at each call site. |
| Clean up in a root-level `afterEach`, with a sync `exit` listener as a backstop. | `afterEach` removes the folder when each test ends, pass or fail (criterion 1). The `exit` listener covers folders made at file level and a test that throws before the hook is registered. |
| Export `tempDir(prefix)` from `test-helpers.mjs` and use it in every hand-written `mkdtempSync` call in tests (`tmp()` in cli-init, config, events, `scratch()` in cli-pr, `scratchDir()` in scenario-helpers tests, and the inline calls in cli.test.mjs and golden-helpers tests). | One rule for tests: no direct `mkdtempSync` outside the helper. |
| `fake-gh.mjs` imports `tempDir` for its default `dir`. | It is the only helper that makes a folder on its own. It is a test helper, so importing another test helper adds no dependency (ADR-0003). |
| Leave `try/finally` that already exists. Remove it only where `tempDir` makes it dead code. | Smaller diff. The hook removes an already removed folder with `force: true`, so both are safe. |
| Leave `planMigration` and `runScenario` unchanged. | They clean up already (`removeOnExit`, `finally`). Production code gets no test-only change. |
| Prove criterion 2 with a runner, `scripts/run-tests.mjs`, which `npm test` calls. | See below. |
| Do not add a test that runs the suite from inside the suite. | It would run every file twice and recurse. |

## Proof of criterion 2

`scripts/run-tests.mjs` (no dependencies, `node:` modules only):

1. It makes a private folder with `mkdtempSync` in the real temp folder.
2. It runs `node --test "scripts/**/*.test.mjs"` with `TMPDIR`, `TMP` and `TEMP` set to the private folder and with inherited stdio. `os.tmpdir()` in every test process then points inside it.
3. After the run it lists the private folder. If it holds anything, it prints each name, removes the folder, and exits with code 1 even when the tests passed. If it is empty, it removes the folder and exits with the test run's code.

Because the folder is private to this run, another process creating `pmkit-*` folders in the shared temp folder cannot fail the check. The check adds no run time beyond one directory listing. It matches every leaked name, not only `pmkit-*`, which is stricter than the criterion. It also stops a test from leaking into the user's real temp folder during the check.

`package.json` changes `"test"` to `node scripts/run-tests.mjs`. `node --test` on a single file still works for fast runs, and it uses the same registry. The runner exports a `findLeaks(dir)` function so a small `run-tests.test.mjs` can cover the exit logic: an empty folder gives no leaks, and a folder with `pmkit-x` gives one. That test also checks the registry by calling `tempDir`, simulating the hook, and asserting that the folder is gone. A test for the failure path of the `afterEach` hook uses a fixture file run with `node --test` and `TMPDIR` set to a scratch folder: the fixture creates a folder and then throws, and the test asserts the folder is gone.

## Acceptance criteria to design

| Criterion | Design part |
| --- | --- |
| 1. Every test that makes a temp directory removes it when the test ends, pass or fail | `tempDir` registry with the root-level `afterEach`; `makeRepo`, `fakeGh` and all hand-written `mkdtempSync` calls in tests routed through it; the failing-fixture test |
| 2. `npm test` leaves no `pmkit-*` directory in the temp folder | `scripts/run-tests.mjs` with a private `TMPDIR`, the `findLeaks` check, `npm test` pointing at it; a manual check of `ls /tmp \| grep -c pmkit` before and after |

## Risks and non-goals

- A test that spawns a child process which makes its own temp folder in `os.tmpdir()` leaks outside the registry. The runner catches it, because children inherit `TMPDIR`. Today `planMigration` is the only such case and it cleans up.
- `exit` listeners run only on normal exit and on `process.exit`. A killed process (SIGKILL, tmpfs full) can still leave folders. This is out of scope.
- Folders left by earlier runs stay until someone removes them. This change does not clean the existing ones.
- Tests that call `run(os.tmpdir(), ...)` only read the folder and are unchanged.
- Node 18 has no root-level hooks problem: `afterEach` exists since 18.8. The ADR-0003 floor holds.
