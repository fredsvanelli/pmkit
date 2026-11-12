# PMK-270: a Supersedes line a reader of the tracker can follow

Source: PMK-270, from PMK-268 (PR #220). Decisions below are the implementer's calls; the brainstorming questions were skipped because the coordinator cannot answer them and the issue plus PMK-268 settle the rule.

## Problem

`docs adr-status --by` (PMK-268) writes the `superseded by` mark of the old ADR relative to the ADR that holds it when both ADRs are in a tracker outside the repository. `/pmkit:spec:record-decision` step 4 still writes `Supersedes: ADR 0001, <ref>` with the `ref` of `docs adr-get`, which is the path from the repository root (`../outside/docs/adr/0001-a.md`). The pair has two bases and a reader of the tracker alone cannot open the second.

## Rule

The `Supersedes:` line follows the rule of `--by`: relative to the ADR that holds the line when both ADRs are in a tracker outside the repository, from the repository root in every other case.

## Design

- `scripts/lib/adr.mjs` gets one small function, `adrRef(holder, target, trackerFolder)`. `holder` and `target` are `{ place, file, ref }`. It returns the path from the folder of `holder` to `target` (with `/`) when both are `place: 'tracker'` and `trackerFolder` is `null` (the tracker is outside the repository), and `target.ref` otherwise.
- `runAdrStatus` (`scripts/pmkit.mjs`) calls it in place of its inline expression. Behaviour does not change.
- `docs adr-get <number>` takes an optional `--from <path>`: the `path` that `docs next-adr` returned for the new ADR. The new ADR does not exist yet, so the CLI finds its folder from the label of the path (`adrFolders`) and takes the holder's file as folder `dir` plus the file name. The JSON gets `supersedesRef`: `adrRef(newAdr, oldAdr, trackerFolder)`, or `null` when `--from` is absent. `ref` keeps meaning the path from the repository root. A `--from` that names no known ADR folder, or a name that is not an ADR file name, is `INVALID_INPUT`. The text output prints a `supersedes ref` line when `--from` is given.
- `commands/spec/record-decision.md`: step 2 still reads `adr-get` without `--from` (the new path is not known yet). Step 4 runs `docs adr-get <old number> --from <path of step 3> --json` again for each replaced ADR and writes the `Supersedes:` line with `supersedesRef`. Step 5 repeats this when the number or path changes. Every other rule of the file stays as it is.

## Non-goals

- ADRs inside the repository (they keep `ref`).
- Rewriting `Supersedes:` lines already written.
- Linear: no tracker folder, so `supersedesRef` equals `ref`.

## Acceptance

1. Both ADRs in a tracker outside the repository: `supersedesRef` is the name of the old ADR relative to the new one's folder (test).
2. It equals the base `docs adr-status --by` writes into the old ADR (test compares the two).
3. Repository ADRs, a tracker inside the repository, and a new ADR in the repository with an old one in the outside tracker keep `ref` (tests).
