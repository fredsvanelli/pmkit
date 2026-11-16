# PMK-207: dry-run and customer paths of the request queue

Follow-up of PMK-70 (PR #119). Size: small change, one command file and one scenario file. No CLI code changes.

## Decisions (made without the user, as the orchestrator brief says)

1. **Failed create dry run (step 5.1).** Same rule step 5.2 already has: a failed `issues create --dry-run` drops that request's decision, says why (`error.message` and `nextStep`), removes nothing else, and the other requests go on. The request stays open. When nothing is left, the existing "nothing would change" stop applies.
2. **Customer with no file.** The "who asked" line of the description file is, in order: the customer name when known, the `from` text, the customer ID (`customer` field of the request) when the customer has no file. Never a guessed name. The ID is the only fact the request holds.
3. **Triage suggestion scenario.** A new entry that runs the Linear path with the in-process fake Linear API (`linear: {}`, pattern of `issues-run-view.mjs`), so `capabilities` succeeds with `request_queue.path` `absent` and the command suggests `/pmkit:backlog:triage` and stops. The old AUTH entry stays (it covers the failure of step 1).
4. **Scenario for 1 and 2.** One new Local entry: a request with `--customer CUS-...` that has no file and no `from`, plus a second request whose create dry run fails (empty title file). It proves the description keeps the ID and that the failed dry run drops only its own request.

## Acceptance criteria map

- AC1 -> decision 1 (command text + scenario).
- AC2 -> decision 2.
- AC3 -> decision 3.

## Out of scope

`docs/superpowers/epc-6-follow-ups.md` improvements.
