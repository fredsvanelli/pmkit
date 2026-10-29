---
id: PMK-172
title: Fix the open correctness findings in the Linear adapter
type: bug
status: backlog
priority: medium
estimate: 8
related: [PMK-30]
created: 2026-10-29T02:47:21.600Z
updated: 2026-10-29T02:47:21Z
---

## Description

Correctness findings from the EPC-5 reviews that are still open on main. Each item names the file, the problem and the fix.

Client and store
1. scripts/lib/linear/client.mjs:384-387. `paginate` throws on a null cursor even when the limit or the page cap already ended the read. Fix by checking the stop conditions first.
2. scripts/lib/linear/client.mjs:299. A `JSON.stringify` failure (a BigInt variable) becomes "network error", and a mutation then says "did not confirm" though nothing was sent. Fix by serializing before the `try`.
3. scripts/lib/linear/client.mjs:232-238. A mutation with two fields, non-null data and an AUTH, FORBIDDEN or RATELIMITED error tells the user to retry. Fix by using the "check whether applied" step.
4. scripts/lib/linear/client.mjs:249-250. `timeoutMs` and `retries` are not validated, and a `retries` of NaN loops forever. Fix by validating both as positive integers.
5. scripts/lib/user-store.mjs:165. The undefined check is `text.includes('"value"')`. Fix by testing `value === undefined` and rejecting functions and symbols.
6. scripts/lib/user-store.mjs:238. `defaultsUnset` misses quoted keys (`"key":`). Fix by matching both forms.

Discovery cache
7. scripts/lib/linear/tracker.mjs:29. `isRawDiscovery` does not check `flags` or `truncated`, so a cache entry without them makes `discover` and `capabilities` throw a TypeError. Fix by checking both.
8. scripts/lib/linear/discovery.mjs:83-84 with tracker.mjs:56. A one-off server error on the plan or integrations request is cached for the full hour (plan unknown, integrations null). Fix by skipping the cache write when a `tolerant` fallback ran.

Filters and counts
9. scripts/lib/linear/filter.mjs:36. The description search on Linear also matches the criteria section, and Local searches only title and description. Fix by re-checking the text after the read.
10. scripts/lib/linear/filter.mjs:50. A labels filter that names a type label (Bug) matches on Linear, but the output never lists that label. Fix by refusing or dropping those names.
11. scripts/pmkit.mjs:607. The native line says "of N issues", but `Project.scope` is likely estimate points. Fix by printing "scope N".
12. scripts/pmkit.mjs:285-287, :384 and :609. The warnings hardcode 1000. Fix by exporting the cap (100 x 10) and using it.
13. scripts/lib/linear/project-ops.mjs:88. The sub-issue levels ignore `hasMore`, so more than 1000 children undercount silently. Fix by carrying `hasMore` into the result.
14. scripts/lib/linear/cycle-ops.mjs:113. `updateIssue` looks up the cycle again and reads each issue twice, which adds N requests. Fix by passing the node already read.

Messages and prompts
15. scripts/lib/linear/manifest.mjs:20 and the `logTime` stub in tracker.mjs:148. The log-time message and the next step print the same text. Fix by giving the next step its own advice.
16. scripts/lib/linear/mappings.mjs:47-58. The in-review candidates include the state a kept `blocked` mapping already names, and picking it gives an error about `blocked`. Fix by removing that state from the candidates.
17. scripts/pmkit.mjs:272-281 (`whoami`). `whoami --json` drops extra member keys and prints keys in a fixed order. Fix by returning the member as stored.
18. scripts/pmkit.mjs:1056 and scripts/lib/args.mjs:4. `--off` is in the global BOOLEANS, so every command treats it as valueless. Fix by scoping it to the command that needs it.

Migrate
19. scripts/lib/local/migrate-fields.mjs:240 and :19-20. Import writes the epic `created` in whole seconds, and Local writes it in milliseconds. Fix by dropping `seconds()` there and naming the epic in the comment.

## Acceptance criteria

- [ ] Item 1: `paginate` returns the nodes read when the limit or the page cap ends the read, even with a null cursor
- [ ] Item 2: A variable that cannot be serialized gives an INVALID_INPUT error and sends nothing
- [ ] Item 3: A mutation answer with data and an auth or rate-limit error tells the user to check whether it applied
- [ ] Item 4: `timeoutMs` and `retries` outside positive integers fail with INVALID_INPUT
- [ ] Item 5: The cache rejects undefined, functions and symbols and accepts a value that contains the text "value"
- [ ] Item 6: `defaultsUnset` removes a quoted key
- [ ] Item 7: A cache entry without `flags` or `truncated` is ignored and fetched again
- [ ] Item 8: A one-off server error on the plan or integrations request is not cached
- [ ] Item 9: The Linear description search ignores the criteria section
- [ ] Item 10: A labels filter that names a type label is refused or the name is dropped, with a message
- [ ] Item 11: The native line prints "scope N"
- [ ] Item 12: One exported cap feeds every "1000" warning
- [ ] Item 13: More than 1000 children give a `hasMore` warning, not a silent undercount
- [ ] Item 14: `cycle add` makes no repeated cycle lookup or issue read
- [ ] Item 15: The log-time message and the next step differ
- [ ] Item 16: A kept `blocked` state is not offered as an in-review candidate
- [ ] Item 17: `whoami --json` returns every member key in stored order
- [ ] Item 18: `--off` is valueless only for the command that declares it
- [ ] Item 19: Import writes the epic `created` in the same form as Local
