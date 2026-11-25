# PMK-370: check the Jira sprint flows against a live site

Issue PMK-370 (EPC-14, chore), follow-up of PMK-78. Written on 2026-11-24 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-78 built the sprint operations (`cycle-ops.mjs`, `sprints.mjs`, the sprint field in `issues.mjs`, the Sprint changelog in `history.mjs`) from Atlassian's documents and checked them only on the stateful fake (`scripts/fake-jira-issues.mjs`). PMK-393 made a team-managed board with Sprints on serve them, so Kudos can now run them. Run the `cycles-jira` runbook's flows on the owner's site, settle each point the fake assumed, fix what differs, and leave a check that reruns in one line (the opt-in harness of PR #391, `scripts/lib/jira/client-live.mjs`, `PMKIT_LIVE`).

## Acceptance criteria (from the issue)

1. `cycle open` creates and starts a sprint on a real Scrum board; `cycle close` completes it.
2. What Jira does with unfinished work items after a REST close is recorded, and ADR 0016 still holds.
3. Sprint dates written at 12:00 UTC show the intended calendar day in the Jira UI.
4. Sprints of other boards in the board list and the Sprint field are handled as the design says.
5. The Agile move endpoints accept a work item the board filter hides, or the refusal is mapped.
6. The Sprint changelog item's `from`/`to` hold sprint ids as the history mapping assumes.

## What a live probe found (2026-11-24)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). One space, Kudos (KAN, team-managed, Portuguese; Backlog, Sprints and Estimation on, Releases off), one board (id 1, `type: simple`, filter `project = KAN ORDER BY Rank ASC`, fixed on a team-managed space), Sprint field `customfield_10020`, no sprint and no work item. The token owner's profile time zone is `Australia/Sydney` (UTC+11 in November). The probe made sprints and work items through the raw client and deleted them; Kudos is empty again (no sprint, no work item).

| Probe | AC | Live answer | Holds? |
|---|---|---|---|
| `POST /sprint` with dates at `T12:00:00.000Z`, then `POST /sprint/{id}` `{state: active}`, then `{state: closed}` | 1 | `future`, then `active` (dates kept as sent), then `closed` with `completeDate` | yes |
| `DELETE /sprint/{id}` on a closed sprint | — | 204, then 404: a closed sprint can be deleted, so a run leaves no sprint | cleanup works |
| REST close of an active sprint with three unfinished items while a future sprint exists | 2 | the items keep only the closed sprint in the Sprint field (`state: closed`, `completeDate`), are not moved to the future sprint, and `GET /board/1/backlog` lists them | yes: ADR 0016's "else no sprint" reads them as backlog, the fake keeps them in the closed sprint too |
| Sprint changelog item after `POST /sprint/3/issue` | 6 | `{ field: Sprint, fieldId: customfield_10020, from: "", to: "3", toString: <name> }` | yes: `history.mjs` reads `fieldId` and splits ids on commas |
| `POST /sprint/{id}/issue` with an epic | 5 | 204; the epic's Sprint field holds the sprint | accepted (pmkit leaves epics out of issue flows, ADR 0017) |
| `POST /sprint/{id}/issue` with a subtask whose parent is in no sprint | 5 | **204, but nothing changes**: the subtask's Sprint field stays null; once its parent joins, it holds the parent's sprint | **silent no-op** (see Fixes) |
| `GET /board` | 4 | one board on the site; a team-managed space has one board, and its filter takes every item of the space | no other board to check |

## Approaches

- **A. One more live test in `client-live.mjs`, running the real CLI on Kudos (recommended).** The PMK-367 pattern: `liveRepo`, `init` with every recommendation, then the runbook's commands (`cycle open --dry-run`, `cycle open`, `cycle add`, `issues list --sprint`, `cycle close`), each checked against Jira's raw answers (`client().request`). Every sprint and work item the run makes is recorded and deleted in `finally`; any sprint of the board absent before the run is deleted too (Jira may make one). Opt-in, so `npm test` does not run it.
- **B. Drive `cycleOperations` directly.** Fewer moving parts, but the ACs name the CLI and the runbook documents it. Rejected.
- **C. A new live harness.** The task says reuse PR #391's. Rejected.

A.

## Design (approach A)

### Live test, in `client-live.mjs`

`test('sprint flows on the throwaway space', { skip: NEEDS_SPACE })` (PMK-370). It skips with a reason when the space's `cycles` capability is not `native`. Steps:

1. **Before.** The board's sprint ids (raw `GET /board/{id}/sprint`), kept to tell the run's sprints from any already there.
2. **Open, dry run.** `cycle open --start <today> --goal <run> --dry-run`: `after.id` null, state `active`; the raw sprint list is unchanged (AC 1).
3. **Open.** `cycle open --start <today> --goal <run> --name pmkit-live <run>`: state `active`, `start` today, `end` today + 13. Raw sprint: `state: active`, `startDate` and `endDate` exactly `<date>T12:00:00.000Z`, `originBoardId` the board (AC 1, AC 3).
4. **Second sprint.** `cycle open --start <today + 14>`: state `planned` (another is active).
5. **Add.** Two work items A and B (`issues create`), `cycle add A B --to <first>`: `after.sprint` is the first sprint on each; raw Sprint field of A holds it; `issues list --sprint current` lists A and B (retried: the index trails).
6. **Changelog.** Raw `GET issue/A?expand=changelog`: the Sprint item has `fieldId` the mapped sprint field, `from` empty and `to` the sprint id; `issues get A --history` has an `update sprint` event `null → <first>` (AC 6).
7. **Subtask.** A work item P in no sprint and its subtask S, made through the raw client (pmkit creates no subtasks). `cycle add S --to <first>` is refused with the mapped error (see Fixes), and S's raw Sprint field stays empty (AC 5's "refusal is mapped", for the item Kudos can make that the move ignores).
8. **Close.** `issues move B done`; `cycle close <first> --dry-run`: `unfinished` is A, the sprint is still active raw; `cycle close <first>`: `sprint.state` `closed`, `closed` set; raw sprint `state: closed` with `completeDate` (AC 1).
9. **After the close.** Raw A: Sprint field holds only the closed sprint, A is in `GET /board/{id}/backlog`; `issues list --sprint none` lists A, not B; `issues get B` has `sprint: <first>` (ADR 0016, AC 2). Not moved to the planned second sprint.
10. **Cleanup** (`finally`): delete the work items (children first) with `removeAll`, then every board sprint not in step 1's list, then check both are gone. Each key and sprint id is printed (`t.diagnostic`) as soon as it exists.

Output prints keys, ids and counts only; `scrub`, `hostless` and `assertNoSecret` cover every answer.

### AC 3: the day in the Jira UI

The raw dates are checked exactly in step 3. The UI renders them in the viewer's profile time zone: 12:00 UTC is 23:00 the same day in `Australia/Sydney` (UTC+11), the owner's zone, so the same calendar day, at the edge the PMK-78 design names (UTC-11 to UTC+11). **My call:** look at the sprint once in the Jira UI through the browser tool, if it is connected and signed in to the site, and record what it shows; if not, record the computation and leave the UI look open in the PR. A zone beyond UTC+11 (New Zealand in summer, UTC+13) shows the next day: recorded as a known limit in the runbook, no change (PMK-78 Q6 chose noon UTC).

### AC 4: other boards

A team-managed space has one board, and the site has no other. Checking needs a second board whose sprints hold Kudos items: a saved filter `project = KAN` and a Scrum board on it, both site-level objects outside Kudos. See Q1.

### Fixes

Test-first, in this PR.

- **A move Jira ignores is reported, not shown as done.** `updateIssue` (`issue-ops.mjs`) re-reads the item after the Agile move; when the target is a sprint and the item's sprint is not that sprint, it throws `CONFLICT` "Jira did not move <key> to sprint <id>" with, for a subtask (Jira's work type level -1), "Jira keeps a subtask in its parent's sprint" and next step `pmkit cycle add <parent> --to <id>`. `moveToCycle` turns it into its `stoppedHalfway` answer as for any failure. A move to the backlog (`none`) is not checked: a done item reads its last closed sprint there (ADR 0016). The fake ignores a subtask's move the way the site does. Unit tests in `issue-ops.test.mjs` / `cycle-ops.test.mjs` first. This is the "refusal is mapped" branch of AC 5, whatever item Jira ignores.
- Any other difference the live run finds, likewise.

### Docs

- `docs/runbooks/cycles-jira.md`: the live-check line records the run, what passed and what was skipped; a step for the subtask refusal (verified by `scripts/runbook-cycles-jira.test.mjs` on the fake); the "Before you start" note that a REST close leaves unfinished items in the closed sprint (Jira's backlog shows them); the time-zone limit.
- ADR 0016: a consequence line that a REST close leaves unfinished items in the closed sprint, checked live; no new ADR.
- No new `CONTEXT.md` term.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; any difference fixed test-first; the result recorded on PMK-370 and in the runbook.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); starting a sprint made in Jira (PMK-369).
- Anti-goals: a write outside Kudos without the owner's yes (Q1); anything left on the site; the host, email, token or account in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-cycles-jira.test.mjs` (with the new step), the other Jira runbook tests, then `client-live.mjs` on the live site.

## Open questions for the owner

- **Q1. AC 4 needs a second board.** (a) Create a saved filter `project = KAN` and a Scrum board on it (site-level, located on the token's user, not in Kudos), run: a sprint of that board holding a Kudos item reads as no sprint of board 1, `cycle list` leaves it out even when `GET /board/1/sprint` lists it, `cycle add` to its id is refused; then delete the sprint, the board and the filter. (b) Skip AC 4 live (unit tests cover it on the fake), leave it open in the PR with the company-managed checks. Recommend (a): it is the only way to settle the point, and everything it makes is deleted; but it writes outside Kudos, which the task forbids without your yes.
- **Q2. The silent subtask move.** Fix it in this PR as above (recommended: a `cycle add` that reports success while Jira did nothing misleads `/pmkit:cycle:plan`, and the fix is one re-read check), or file a follow-up in EPC-14 and only record it here.

## Left to the builder

Assertion wording, the retry interval, the sprint names, and how the subtask is recognized (the work type's `subtask` flag or hierarchy level).
