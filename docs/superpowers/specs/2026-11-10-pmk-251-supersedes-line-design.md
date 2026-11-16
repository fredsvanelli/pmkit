# PMK-251: Write the Supersedes line in a new ADR

Follow-up of PMK-228. `docs adr-status` marks an old ADR "superseded by" a new one, but the new ADR names nothing, so the link runs one way. The worker was told to decide without asking; every choice marked **(builder's call)** is the implementer's.

## Goals

1. A new ADR that replaces an older one has the line `Supersedes: ADR <old number>, <old ref>`.
2. After the run the older ADR is marked superseded by the new one, after its own confirmation.
3. A decision that replaces no ADR is written as before.

## Non-goals

- Finding replaced ADRs from the text of other ADRs; the user names the number.
- Changing ADRs that already exist, other than the one marked.
- A new CLI command. `docs adr-status` already does the marking; the one CLI change is that it also returns `ref` (the path without the `tracker:` display label PMK-247 keeps), which the Supersedes line uses.

## Design

- Step 1 asks once whether the decision replaces an older ADR, by number. **(builder's call)** Only one older ADR; a decision that replaces several is marked ADR by ADR with `/pmkit:spec:adr-status`.
- Step 2 looks the old ADR up with `docs adr-status <old> deprecated --dry-run`, which only reads, for its `number`, `ref`, `path`, `place` and `status.before` (a warning when it is already superseded). **(builder's call)** The CLI has no read-only ADR lookup and adding one is out of scope. `NOT_FOUND`/`CONFLICT`/`INVALID_INPUT` stop before any write.
- Step 4 puts `Supersedes: ADR <old number>, <old ref>` right under the title (under a status line when the ADR format has one there), so a reader sees it first; it uses the `ref`, never the `path`, so a tracker outside the repo never leaks `tracker:`. **(builder's call)** The line goes in the draft, so step 5's confirmation covers it.
- New step 7 runs `docs adr-status <old> superseded --by <new> --dry-run`, shows it, asks once whatever `write_policy.confirm` says, then writes. A decline or failure leaves the older ADR alone, keeps the new ADR and offers `/pmkit:spec:adr-status`. It does not depend on step 6, so a failed comment does not skip it. Step 6 keeps its rule: a failed write stops the batch, and step 8 lists what changed and what is left.
- Old steps 7 and 8 become 8 and 9.

## Tests

`plugin.test.mjs` pins the new sentences of steps 2, 4 and 7. `spec-record-decision` gets a third scenario entry (replaces ADR 0002); the two existing entries skip the new calls with a reason, which also proves the no-replacement path is unchanged.
