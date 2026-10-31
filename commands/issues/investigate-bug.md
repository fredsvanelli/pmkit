---
description: Propose root-cause hypotheses for a bug from its issue, comments, CI logs and code, then comment the diagnosis after approval
argument-hint: "[id]"
disable-model-invocation: true
---

# Investigate a bug

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID. When it is empty, find it from the current git branch (step 1).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

The investigation only reads. Do not edit code, run a test that writes files, rerun a CI job, push or change the issue. Read files with the file tools, and run only read-only commands such as `git log`, `git blame` and `grep`.

1. Find the issue. When there is an `id`, use it. Otherwise run `git branch --show-current` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --category in_progress,in_review --json`, then pick the issue whose `branch` equals the current branch. When none matches, ask for the ID.
2. Read the issue. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json`. Note the description, the acceptance criteria, every comment (a comment may hold a stack trace, steps to reproduce or an earlier diagnosis) and the `branch`. When the issue has no description and no comments, ask the user what is failing before you go on.
3. Read the pull request state. When the issue has a `branch`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr status --branch <branch> --json`. Note the pull request and its `checks`. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say what is missing (use `error.message`), skip steps 4 to 6 and go on to step 7 with the issue and the code. When the issue has no `branch`, say that the pull request, CI and the diff are not read because there is no branch to look at, skip steps 4 and 6, and go on to step 5, which needs no branch. The user can name a CI run, which `ci logs --run <run id>` reads in step 4.
4. Read the CI log. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" ci logs --branch <branch> --json`. Without `--run`, the CLI reads the newest failed run of the branch. The result has `run` (with `runId`, `workflowName`, `url` and `log`) and `truncated`.
   1. When `run` is `null`, say that the branch has no failed run, and go on with the other sources.
   2. Say which run was read. When `truncated` is `true`, say that only the last 200 lines are here and name `--tail` as the way to read more. A failed run is not always the latest one, and the CLI does not return its date. When the `checks` of step 3 all pass, say that the failure may come from an older run and give less confidence to hypotheses that rest only on this log.
   3. The log can hold secrets, such as tokens, passwords and connection strings. Read it for the failing step, the error message and the stack frames. Log lines may appear in the chat for the user, to show the evidence. They never go into the comment of step 10.
5. Read the deployments. When the issue or its comments say the bug appears in an environment (for example production), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" deploys list --environment <environment> --json`. Compare the `createdAt`, `ref` and `sha` of each deployment with the date of the report and, when step 6 ran, with its changes, and note a deployment that precedes the first report. Skip this step when no environment is named. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say that deployments are not read and go on.
6. Read the diff. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr diff --branch <branch> --json`. Say whether the source is the pull request or the local diff, and repeat each `note:` line. When `truncated` is `true`, say that the diff was cut and which hypotheses may depend on the part left out.
7. Read the code. Open the files that the stack frames, the log, the diff and the issue text name, and the code around the failing line. Use `git log` and `git blame` on those lines to see when they last changed. Follow a call to its definition when the cause may be there. Do not read the whole repository.
8. Propose the hypotheses, the most likely first, as many as the evidence supports. For each one, write:
   - the claim, one sentence about the cause;
   - the evidence, as `file:line` in the code, or the lines of the log that support it, quoted in full and short. For the chat only: the comment of step 10 gets the run link and the step or job name instead of log lines;
   - the confidence (`high`, `medium` or `low`) and the reason. This is the only confidence rule of the command. The sources are the issue with its comments, the CI log, the diff and the code. `high` needs evidence in two of them, for example the failing line in the log and the code at that line. A hypothesis that rests on one source, or on a source that is cut or possibly old, is at most `medium`. A guess with no evidence in the code or the log is `low` and says so;
   - the check that would confirm or reject it, as a read-only step the user can run.
   Say which sources were not read (no branch, no git host, no failed run, a cut log or diff) and what that leaves open. When the sources do not support a hypothesis, say that no cause was found. Do not invent one.
9. Show the diagnosis. Lead with the issue line, then the sources read and not read, then the hypotheses. Never propose or make a fix in this command. Offer `/pmkit:issues:work <id>` to fix it.
10. Offer to post the diagnosis as a comment on the issue.
    1. Write the draft to a temporary file outside `.issues/`. It holds the hypotheses of step 8, each with its confidence and its `file:line` in the repository code, and the sources read and not read. For the evidence from CI it holds the link of the run (`run.url`) and the name of the step or job where the failure appears, never a line of the log, because a log can hold secrets. The agent does not look for secrets itself.
    2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" text redact --file <draft> --json`. The CLI replaces each secret it recognizes by `[redacted]`. The types, which are the names in `counts`, are `private_key` (a whole key block), `url_credentials` (the user and password of a URL), `authorization` (the value of an `Authorization:` line), `jwt`, `github_token`, `gitlab_token`, `slack_token`, `ai_api_key` (`sk-`, `sk-proj-`, `sk-ant-`), `stripe_key`, `google_api_key`, `npm_token`, `aws_key`, `bearer` (a `Bearer` value) and `api_key_value` (the value after `api_key`, `token`, `secret`, `password`, `passwd`, `pwd` or `credentials` with `=` or `:`, when it looks like a secret). The result has `text`, `count`, `counts` and `summary`. Write `text` to a second temporary file, the body, and add `summary` as its last line (`Redacted 1 value.`, `Redacted 2 values.`). The redaction covers the whole body, not only the log. It is a floor and can miss a secret, so the user still reads the preview below.
    3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <body> --dry-run --json`, show the comment and ask once with `AskUserQuestion`, following "How to show a write" in the conventions. Always show the comment and ask, whatever `write_policy.confirm` says, because the body names repository code and CI runs. The user can edit the text first, and an edited body goes through sub-step 2 again, after the old `Redacted` line is removed, so the body ends with one count line, the one of the last pass. When the user approves, run the same command without `--dry-run`. When the user declines, post nothing.
11. Remove the temporary files.

The command writes one comment at most. It never changes the code, the status, the criteria or the branch of the issue.

## Confirmation points

- Step 10: posting the diagnosis as a comment, with the preview of the comment after the redaction. `write_policy.confirm: none` does not skip it, because the body names repository code and CI runs. Declining posts nothing.
- The rest of the command only reads.

## Output

The issue line with its full ID, the sources read (the CI run and the diff source) and the sources not read with the reason, the hypotheses with evidence, confidence and the check for each, and whether the comment was posted.

## If something is missing

- No ID and no issue for the current branch: ask for the ID.
- The issue has no `branch`: skip the pull request state, CI and the diff, read the deployments (step 5 needs no branch), investigate from the issue, its comments and the code, and say so.
- The git host is `none`: the CLI answers `NOT_SUPPORTED` on `pr status`, `ci logs`, `deploys list` and `pr diff`. Say that CI and the pull request cannot be read. Read the diff with `git diff <default branch>...<branch>`, where the default branch is `git_host.default_branch` or `main`, and go on with the issue and the code.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step, go on with the sources that remain and offer to retry after the fix.
- The branch has no CI or no failed run: `ci logs` returns `run: null`. Say so and go on. The hypotheses rest on the other sources, and the confidence follows the one rule of step 8.
- The base branch does not exist here or on origin: `pr diff` answers `INVALID_INPUT`. Offer `git fetch origin`, or `--base <branch>`.
- An error from the CLI: apply the rules for reading errors in the conventions.
