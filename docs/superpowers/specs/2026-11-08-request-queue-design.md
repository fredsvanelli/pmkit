# request-queue command (PMK-70)

## Intent

A PM wants the requests that reach the team (support, sales, internal teams) worked off the inbox: each one turned into a new issue, linked to an issue that already covers it, or declined, without opening request files by hand.

## Decisions at the confirmation points (taken without asking, per the orchestrator brief)

- Command lives in `commands/backlog/request-queue.md`, next to `triage` and `prioritize-by-demand`.
- One decision per open request: new issue, link to an existing issue, decline (with an optional reason), or leave open.

## Goals

- Read `capabilities` and `request_queue`. Native (Local): list the open requests with `requests list --json`. Not native (Linear, or any tracker without it): say there is no request queue, suggest `/pmkit:backlog:triage`, and stop.
- For each open request show ID, title, customer (or `from`), importance and body, plus the open issues that look like the same ask (from one `issues list`), so linking is a real option.
- Collect the decisions, show a full preview, ask once, and write one at a time.
  - New issue: `issues create` from the request title and body, then `requests accept <req> <new issue>`.
  - Link: `requests accept <req> <issue>`.
  - Decline: `requests decline <req> [--reason]`.
- An accepted request becomes a demand signal, so the output points to `/pmkit:backlog:prioritize-by-demand`.

## Non-goals

- A new CLI command: every call exists (PMK-46). No change to capabilities.
- Creating customers, editing request text, accepting and creating in one call (PMK-46 follow-ups).
- Deciding for the user: the command proposes matches, never links on its own.

## Constraints

- Incomplete reads are never a conclusion. `problems` in `requests list` means a request file did not parse: show each as a warning, never say "the inbox is empty" (say "no open request found, N files not read"), and point to `pmkit validate`. The readable requests are independent records, so they can still be processed. When the issue list for matches has `hasMore` or `problems`, say matches may be missing and do not claim "no existing issue covers this".
- A `NOT_SUPPORTED` answer from `requests list` means no queue, not an empty one: same triage suggestion.
- A customer name of `null` is shown as unknown, never guessed.
- The full preview and its question always come first, whatever `write_policy.confirm` says (it can change several records).
- A write that fails stops: list applied and not applied, never retry. A create that succeeded and whose accept failed reports both IDs; the request stays open and the next run links it to the new issue.
- Dry-run before every write. The accept into a new issue cannot be dry-run before the issue exists, so its preview shows the `issues create` dry-run and says the accept is checked right after the create.

## Left to the builder

Wording, scenario fixture, registry changes (README, SKILL.md, CHANGELOG, counts).
