---
description: Portfolio review of epics and milestones with dates, health and delays, and the epics with no recent status update; read-only
argument-hint: ""
disable-model-invocation: true
---

# Roadmap review

Arguments: `$ARGUMENTS`

## Parameters

None. The review covers every epic and milestone of the tracker.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" roadmap review --json`. It reads the issues, the epics, the milestones, the progress and the status updates of each epic. It writes nothing and asks nothing, so it also runs headless. Do no date arithmetic yourself: every date, delay and reason comes from the result.
2. When `incomplete` is `true`, say so first, in one line, and that unknown values are shown as unknown. Then show each entry of `warnings` and each entry of `problems` with its ID. Draw no conclusion from a value that is `null`.
3. Show the epics (`epics`): ID, title, status, start, target, milestones (`milestones`, every milestone by name; `milestone` is only the first ID; a `null` `milestones` means the milestone list could not be read, so write `unknown`, not none), progress as `progress.done` of `progress.total`, health, last update date (`updatesRead` `false` means the update read failed: write `not checked`, never blank or `none`), delay and reasons. A `null` `health` is `unknown`, never a guess from the progress. A `null` `progress` is `unknown`. `delayDays` is the days past the target, `0` is on time and `null` means the epic has no target. Name each reason: `late` (target before today), `at_risk` or `off_track` (health of the newest status update), `no_recent_update` (no status update for more than `statusUpdateWindowDays` days). When `epics` is `null`, write `not checked` and the warning that says why: `unavailable.epics` is `NOT_SUPPORTED` when the tracker has no epics, and the error code (for example `UPSTREAM`) when the read failed. A failed read says nothing about the epics, so never call the tracker epic-less.
4. Show the milestones (`milestones`): ID or name, due date, open, done and canceled issues, epics and delay. A row with `filed: false` is referenced by issues or epics but has no record, so its due date is unknown. A `null` `issues` means the issue counts are unknown. A `null` `delayDays` means the lateness is unknown (no due date, or the issue read was incomplete): write `unknown`, never blank; a filed milestone with no due date reads `no due date`. A `null` `epics` on a milestone means the epic list could not be read, so its epics and a late delay are unknown. When `milestones` is `null`, write `not checked` and the warning that says why (`unavailable.milestones`, as for the epics).
5. Show the epics with no recent status update (`noRecentUpdates`), with their last update date or `none`. Then list `updatesNotChecked` as `not checked`: their updates could not be read (a failed read, a rate limit that stopped the reads, or a tracker without status updates), so they are not stale and not fresh. For each epic in `noRecentUpdates`, offer `/pmkit:report:status <epic>` to draft an update.
6. When `lateIssues` is a list (`unavailable.epics` is `NOT_SUPPORTED`: the tracker cannot list epics), show it as the late issues section: ID, title, status, due date, milestone and delay.
7. Show each entry of `notes` as it comes.

## Confirmation points

None. The command only reads.

## Output

A head line with `today` and `statusUpdateWindowDays`, the incomplete line when there is one, then the sections of steps 3 to 6, ready to paste into a channel. Every epic and issue shows its full ID.

## If something is missing

- No epics and no milestones: say so in one line with the date, and offer `/pmkit:spec:import`.
- A section is `null`: write `not checked` with the warning, as in steps 3 and 4. The other sections still show.
- An error from the CLI: apply the rules for reading errors in the conventions.
