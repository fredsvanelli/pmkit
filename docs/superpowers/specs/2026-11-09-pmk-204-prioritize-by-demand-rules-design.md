# PMK-204: fix the ranking and write rules of prioritize-by-demand

Source: PMK-68 reviews (PR #113). The command is `commands/backlog/prioritize-by-demand.md`; it is a prompt over the CLI, so the fixes are prompt rules plus two small CLI changes that make those rules checkable.

## Decisions

Each one is the implementer's call, taken from the issue text and the code.

1. **Bands cover only issues with demand (AC 1).** Today the whole ranking, score-0 issues included, is split into equal bands, so zero-score issues take band slots and push issues with demand into lower bands. The bands are now formed over the issues with a score above 0. Issues with no score are listed after them and keep their priority. If no candidate has a score, nothing is proposed.
2. **`demand list` problems get an `about` field (AC 2).** The local `listDemandSignals` marks each problem as `request` (a request file that does not parse; it may belong to a candidate), `customer` (a request names a customer with no readable file; the request still counts and the customer is still distinct by ID) or `issue` (a request names an issue that cannot be read, for example a deleted one). The command shows every problem as a warning. It stops the write only for an `about: request` problem, or an `about: issue` problem whose `id` is a candidate.
3. **pmkit's own comments do not count (AC 3).** The comments of `/pmkit:issues:work`, `progress` and `delegate` carry no marker, and they are posted by the person or agent doing the work, who is the issue's assignee. A comment counts as demand only when its author is not the issue's assignee and its first line is not a delegation record (`Delegated to agent:... by ..., to run locally.`). Adding a marker to those comments is out of scope.
4. **One mention rule.** The command uses the rule of `deleteIssue`, now one function in `scripts/lib/mentions.mjs` shared by `deleteIssue` and the scenario check: the ID is not directly preceded by a letter or digit nor followed by a letter, digit or underscore, and URLs, markdown link targets and paths are not mentions. The text read is the title and the description.
5. **Mentions are read per candidate.** Step 4 runs `issues list --text <ID> --json` for each candidate and keeps the hits that pass the whole-token rule (`--text` is a substring match, so it only narrows). A `hasMore` on that read makes that candidate "not verified", so a Linear team with more than 1000 issues is no longer blocked as a whole.
6. **The customer tie-break counts `from`.** Distinct customers are `customers` plus `from` of the signal.
7. **The live scenario checks the whole-token result (AC 4).** In `backlog-prioritize-by-demand.mjs` every assertion that needs only the repo runs before the first `saved` read, and the whole-token check reads the issue files of the copy with the shared rule instead of the saved list. The `LIVE_EXPECT_STOPS` reasons are updated.

## Non-goals

Weighting demand by revenue, a CLI read for mentions, Linear `demand list`, the stale-write guard (PMK-234, PMK-241, PMK-242).
