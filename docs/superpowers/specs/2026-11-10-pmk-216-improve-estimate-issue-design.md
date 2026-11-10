# PMK-216: improve estimate-issue (design)

Source: PMK-59 follow-ups (`docs/superpowers/epc-6-follow-ups.md`). PMK-237 reuses the similarity read.
The brainstorming ran without the user (orchestrated run): the choices below are the worker's, each with its reason.

## Goals

1. A scenario of `/pmkit:issues:estimate` on a tracker with no estimate field, to cover the comment path (step 8).
2. A text-similarity read in the CLI, so the command stops guessing `--text` keywords: `issues similar <id>`.

## Non-goals

- No change to the estimate scale logic, the save path or the `estimation` capability.
- No embedding or network call. PMK-237 (request-queue) calls the same function later; wiring it there is its issue.

## Design: `issues similar <id> [--category c,..] [--limit n]`

- Read only. Default `--category done`, default `--limit 5` (the command file keeps "at most five").
- Candidates: `searchIssues({ categories })`, minus the target. The target is read with `getIssue`.
- Score: cosine of TF-IDF vectors over the title (counted twice), description and acceptance-criteria text. Tokens: lower case, split on non-letters/digits, length >= 3, a small English stop list, trailing `s` removed. The IDF comes from the candidates plus the target, so a word every issue shares weighs nothing. Pure function `rankSimilar(target, candidates, { limit })` in `scripts/lib/similar.mjs`, no I/O, so PMK-237 can call it.
- Only a score above 0 is listed. Each hit carries `shared` (the up-to-5 heaviest shared terms), so the agent can say why it looks alike.
- Result (`--json`): `{ target: {id,title}, similar: [{...issue fields, score, shared}], considered, complete, hasMore, problems }`. Text: the five-column issue table plus `Score` and `Shared` columns.
- Incomplete reads (round-3 and round-7 lessons): an issue file that does not parse (`problems`) or `hasMore` on Linear makes `complete: false` and prints a warning. The command file must not say "no similar issue" from an incomplete read; it says "not verified". An empty `similar` with `complete: true` is the only "none found".
- Works on both adapters (it uses `searchIssues` and `getIssue`), so no capability or `SERVED_BY` change.

## Command file (`commands/issues/estimate.md`, step 5)

Step 5 runs `issues similar <id> --json` instead of the keyword loop. It keeps the rule that an issue with no estimate is listed apart, and adds the incomplete rule. The `issues get <similar id>` read of step 5 goes away because the result carries the estimate. The Local scenario changes to the new call.

## Scenario for the comment path

`scripts/__scenarios__/issues-estimate.mjs` exports an array: the Local entry (save path, now with `issues similar`) and a new Linear entry. The Linear fake workspace has estimates off (`issueEstimationType: notUsed`), so `capabilities` reports `estimation` as not native and the command takes step 8: `issues comment` dry run, confirm, write, and no `issues update --estimate`. The entry seeds a completed ACME issue so the similar read has something to list. Setup follows `issues-run-view.mjs` (a Linear config file, `linear.routes`).
