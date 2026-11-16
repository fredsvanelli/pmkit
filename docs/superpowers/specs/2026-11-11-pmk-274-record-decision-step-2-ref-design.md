# PMK-274: step 2 of record-decision stops pointing at `ref` for the Supersedes line

Source: PMK-274, follow-up of PMK-270 (PR #224). Decisions below are the implementer's calls: the brainstorming questions were not asked, because the brief said to pick the sensible option and go on. The issue and PMK-270's spec settle the rule.

## Problem

PMK-270 made `/pmkit:spec:record-decision` write the `Supersedes:` line from `supersedesRef`, which step 4 reads with `docs adr-get --from`. Step 2 still says the older ADR's `number` and `ref` are kept, and explains the `../...` form of `ref`. Step 4 then tells the agent not to use `ref` for that line. The two steps disagree, and the agent gets a mixed message.

## Rule

The `Supersedes:` line cites `supersedesRef` and only that. Step 2 keeps `number` for the older ADR. `ref` stays in step 2 only as what it is still good for: the path the user sees (without the `tracker:` display label), so the user can find the file. It is never a citation in the ADR.

## Design

- `commands/spec/record-decision.md`, step 2: replace the sentence that keeps `number` and `ref` and explains `../...` with one that keeps `number`, says what `ref` is for, and says the Supersedes line never takes it. The sentence that names `supersedesRef` and step 4 stays.
- The sentence `` `ref` is the path without the display label `tracker:` `` stays verbatim: `scripts/plugin.test.mjs` asserts it.
- Step 4 is already correct (`supersedesRef`, and `ref` only for the fallback when both ADRs are not in an outside tracker). No change there.
- The CLI output of `docs adr-get` is out of scope.

## Non-goals

- Changing `docs adr-get` or its JSON.
- Changing step 4 or step 5.
- Any new scenario. The existing `spec-record-decision` scenario covers the commands and must keep passing.

## Acceptance

1. Step 2 does not tell the agent to keep `ref` for the Supersedes line, and steps 2 and 4 agree that the line cites `supersedesRef` (test: plugin test on step 2 and step 4 text).
2. `scripts/plugin.test.mjs` and the `spec-record-decision` scenario pass, with `npm test` exiting 0.
