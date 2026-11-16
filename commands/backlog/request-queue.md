---
description: Work the open requests (support, sales, internal teams) into new issues, links to existing issues or declines, after a full preview
argument-hint: ""
disable-model-invocation: true
---

# Work the request queue

Arguments: `$ARGUMENTS`

## Parameters

None. The command works the open requests (the inbox) of the tracker.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the `request_queue` entry. When the call fails, apply the rules for reading errors in the conventions and stop. When its `path` is not `native` (Linear, or any tracker without a request queue), say there is no request queue on this tracker, suggest `/pmkit:backlog:triage` to work the issues nobody has looked at, and stop. Change nothing.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" requests list --json`, which lists the open requests, oldest first. When it fails with `NOT_SUPPORTED`, treat it as a missing request queue: do what step 1 says. Show each entry of `problems` as a warning that points to `pmkit validate`. A problem with the code `NOT_FOUND` names a request that was read and is listed, whose customer has no file: show it as "customer unknown" on that request, and it does not make the queue incomplete. Every other problem is a request file that does not parse: it is not listed and cannot be worked, and the queue may hold more than shown. When `requests` is empty, say "no open request found", add "and N files could not be read" with N the problems that are not `NOT_FOUND`, never say the inbox is empty when N is more than 0, and stop. When `requests` is not empty, go on.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category backlog,todo,triage,in_progress,in_review --json` once, for the issues a request could already be about. Show each entry of `problems` as a warning. When `problems` is not empty (an issue file that does not parse may be the one that covers a request), when `hasMore` is true, or when the call fails, the matches are "not verified": say that an issue covering a request may be missing from the proposals, never say that no existing issue covers it, and carry the same warning into the question of step 4 and the preview of step 6, next to every request turned into a new issue. A failed call does not stop the command: the requests are still worked, with the matches marked "not verified".
4. Show the requests, oldest first: ID, title, customer name (or the `from` text; when the customer is known only by ID, say the name is unknown), `important`, and the body. For each request propose the open issues of step 3 that look like the same ask, by title and description, as candidates to link, and say when there is none among those read. Never propose a link as certain. Ask with `AskUserQuestion`, one request at a time, what to do with it: turn it into a new issue, link it to an existing issue (offer the candidates and let the user name another ID), decline it (and ask for a one-line reason, which may be empty), or leave it open. When every answer is "leave it open", stop and change nothing. For a request turned into a new issue, write two temporary files per request outside `.issues/` with the file tool, named after the request ID (for example `<REQ ID>-title.txt` and `<REQ ID>-description.txt`) so two new issues in one run never share a title or a description, never with `echo` or a shell redirect, because the text comes from outside the team and must not reach the shell: a title file with the request title on one line, and a description file with the request body, then who asked (the customer name when known, otherwise the `from` text, otherwise the customer ID the request names when its customer has no file, never a guessed name) and `Request: <REQ ID>`.
5. Prepare each decision with a dry run, using the temporary files written in step 4:
   1. New issue: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title-file <title file> --description-file <description file> --dry-run --json`. The accept cannot be checked before the issue exists, so the preview says that `requests accept` is checked right after the create. A failed dry run caused by the request itself (`INVALID_INPUT`, for example a title file with no title, `NOT_FOUND` or `CONFLICT`) drops that decision and says why, with `error.message` and `error.nextStep`: the request stays open, and the other requests go on. A global error (`NOT_CONFIGURED`, `AUTH`, `RATE_LIMITED`, or any other the conventions say stops the command) is not about this request: apply the conventions, remove the temporary files of step 4 and stop the command.
   2. Link: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" requests accept <request id> <issue id> --dry-run --json`. A failure (the issue does not exist or does not parse) drops that decision and says why.
   3. Decline: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" requests decline <request id> --reason '<reason>' --dry-run --json`, without `--reason` when the user gave none. The reason is text typed by the user, so put it in single quotes and replace each `'` in it by `'\''`; double quotes would let the shell expand it.
   Skip a decision whose `before` equals `after`. When nothing is left, remove the temporary files of step 4 and stop: when every decision was skipped because `before` equals `after`, say nothing would change; when decisions were dropped by a failed dry run, say that no request could be prepared and why, per request.
6. This writes more than one record, so show the full preview: one row per request with the decision (new issue with its title, link to `<issue id>`, decline with its reason) and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user declines, remove the temporary files of step 4 and change nothing.
7. When the user approves, run the same commands of step 5 without `--dry-run`, one request at a time, in the order of step 4. For a new issue run `issues create`, read the new ID, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" requests accept <request id> <new issue id> --dry-run --json` and then the same call without `--dry-run`. When a call fails, remove the temporary files of step 4 and stop: list the requests done, the one that failed and the ones not started, and do not retry. When the create worked and its accept failed, the issue exists and the request is still open: report both IDs, and the next run of the command can link the request to the new issue.
8. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" requests list --json` again and confirm the worked requests are no longer in the open list. Show the entries of `problems` again as warnings. Remove the temporary files of step 4 (the earlier stops remove them too).

## Confirmation points

- Step 4: what to do with each request. Leaving all of them open stops the command.
- Step 6: the full preview of every change, always asked because it changes more than one record. Declining changes nothing.

## Output

For each request: its ID and title, what was done (the new issue with its full ID, the issue it was linked to, or the decline with its reason) or that it stays open. Then the requests still open, the warnings and the issues or requests that were not written. An accepted request is a demand signal for its issue, so end with `/pmkit:backlog:prioritize-by-demand` to rank the work by demand and `/pmkit:issues:find` to see the new issues.

## If something is missing

- No request queue (`request_queue` not native, or `NOT_SUPPORTED`): suggest `/pmkit:backlog:triage` and stop.
- No open request: say so, and say how many request files could not be read when there are any.
- A read that is incomplete (`problems` of `requests list` other than `NOT_FOUND`; `problems`, `hasMore` or a failure of the issue list): the readable requests are still worked, the matches are "not verified", and nothing is concluded from what is missing.
- An error from the CLI: apply the rules for reading errors in the conventions.
