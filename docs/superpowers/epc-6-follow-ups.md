# EPC-6 follow-ups

The implementers and reviewers of EPC-6 ("Remaining generic commands") suggested these improvements. None of them is a defect. The defects found in the same reviews are issues PMK-175 to PMK-207.

Each command's improvements are now one issue, of type feature and priority low, linked as related to the issue the suggestions came from. The full list of items is in each issue.

| Source | Command | Issue |
|---|---|---|
| PMK-48 | alerts list | PMK-208 |
| PMK-49 | deploys list and ci logs | PMK-209 |
| PMK-50 | docs list | PMK-210 |
| PMK-51 | issues time-entries | PMK-211 |
| PMK-44 | saved views | PMK-212 |
| PMK-45 | goals | PMK-213 |
| PMK-57 | delegate | PMK-214 |
| PMK-58 | track-agents | PMK-215 |
| PMK-59 | estimate-issue | PMK-216 |
| PMK-61 | review-pr-against-issue | PMK-217 |
| PMK-62 | unblock-pr | PMK-218 |
| PMK-64 | todos-to-issues | PMK-219 |
| PMK-71 | team load | PMK-220 |
| PMK-46 | customers and requests | PMK-221 |
| PMK-52 | issues delete | PMK-222 |
| PMK-53 | link-repo | PMK-223 |
| PMK-72 | team capacity | PMK-224 |
| PMK-47 | user inbox | PMK-225 |
| PMK-56 | bulk operation | PMK-226 |
| PMK-60 | log-time | PMK-227 |
| PMK-65 | record-decision | PMK-228 |
| PMK-63 | investigate-bug | PMK-229 |
| PMK-73 | security-alerts | PMK-230 |
| PMK-175 | alerts list on Windows | PMK-231 |
| PMK-66 | roadmap-review | PMK-232 |
| PMK-67 | initiatives-and-goals | PMK-233 |
| PMK-68 | prioritize-by-demand | PMK-234 |
| PMK-69 | release-readiness | PMK-235 |
| PMK-55 | inbox-digest | PMK-236 |
| PMK-70 | request-queue | PMK-237 |

Dropped when the issues were created:

- PMK-48: "decide in PMK-73 whether a transitive advisory opens one issue or three". PMK-73 decided one issue per package; folding transitive advisories is in PMK-230.
- PMK-58: "read the newest root delegation comment, and check that the agent is still the assignee". PMK-58 shipped it (`delegationOf` in `scripts/lib/track-agents.mjs`).
- PMK-47: "add a command file and a scenario for the inbox". PMK-55 shipped `/pmkit:issues:inbox-digest` with its scenario.
- PMK-70: "let `requests accept` create the issue in one call". Same item as PMK-46's `requests accept --create`, in PMK-221.
- PMK-63: "have `ci logs` return `createdAt`, `conclusion` and `headSha`". Same as PMK-49's item, in PMK-209.
