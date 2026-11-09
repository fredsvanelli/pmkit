# PMK-181: parseDelegation tolerance and delegate identity text

Size: small change. Sources: PMK-181 (issue), PMK-57 (delegate), PR #87.

## Findings
- `parseDelegation` in `scripts/lib/delegation.mjs` already uses `split(/\r?\n/)[0].trimEnd()` (landed with PMK-58), but no test pins a trailing space or `\r\n`. Keep the code, add the tests.
- Text says `--as` records "the claim, the branch and the PR" as the agent's. `--as` only changes the actor of tracker events (assign, move, comment). Commits and the GitHub PR keep the user's git and gh identity.
- `scripts/contract.test.mjs` `setupLocal` adds `agent:claude`; the suite assigns `members[0]`, which now sorts to the agent. The suite already supports `setup().assignee`.

## Design
1. Add tests for the parse tolerance (trailing spaces, `\r\n`, tabs-free).
2. Reword the comment line in `delegationComment`, `commands/issues/delegate.md` step 7, and the `issues-delegate.after.txt` golden: the tracker events are recorded as the agent's; commits and the PR keep the user's identity.
3. `setupLocal` returns `assignee: 'fred'` (the actor, a person).

Non-goals: `docs/superpowers/epc-6-follow-ups.md` improvements; changing `--as` behavior.
