# investigate-bug command (PMK-63)

## Intent

A developer with a bug issue wants a short list of likely causes with evidence before reading the code alone. The command gathers what the tracker and the git host already hold and reasons over it.

## Goals

- Propose root-cause hypotheses from the issue, its comments, the CI log of the branch and the code.
- Each hypothesis cites `file:line` of the repository code, states a confidence and names a read-only check. The CI evidence is the link of the run and the step or job name.
- Optionally post the diagnosis as one comment after a dry run and one confirmation.

## Non-goals

- Fixing the bug, running tests that write, rerunning CI.
- A CLI command for the data. `issues get --comments`, `pr status`, `ci logs`, `deploys list` and `pr diff` give all of it. The one new command, `text redact`, only replaces secrets in text.

## Constraints

- Read-only except for the comment. The command file says so.
- A CI log can hold secrets, so the comment holds no line of it. It holds the link of the run and the step or job name. Log lines can appear in the chat only. The whole comment body also goes through `pmkit text redact`, a second layer because the issue and its comments can hold secrets too. It replaces them by `[redacted]` and counts them by type (`private_key`, `url_credentials`, `authorization`, `jwt`, `github_token`, `gitlab_token`, `slack_token`, `ai_api_key`, `stripe_key`, `google_api_key`, `npm_token`, `aws_key`, `bearer`, `api_key_value`). The comment ends with the summary line. It is always shown and asked.
- Degraded cases (`git_host: none`, no CI, no failed run, no branch) say what was missing and go on with the rest. Confidence never reaches `high` on one source.
- `ci logs` without `--run` returns the newest failed run, which may be older than a passing run. The command compares with the `pr status` checks and says so.

## Left to the builder

Wording of the steps, the scenario fixture and the registry changes (README, SKILL.md, CHANGELOG, counts).
