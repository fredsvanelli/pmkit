---
id: PMK-391
title: Tidy the PMK-81 Bitbucket git host review minors
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-81]
milestone: jira
created: 2026-11-23T21:45:41.833Z
updated: 2026-11-23T21:45:42Z
---

## Description

Source: the PMK-81 reviews (task reviews, the whole-branch review, ponytail-review and review-work). Minor findings left open on the Bitbucket Cloud git host.

## Acceptance criteria

- [ ] pr status treats a STOPPED Bitbucket build the same way risks and release-readiness do (today pr status buckets it as cancel, the others count it as failing)
- [ ] pr status checks carry GitHub-style state names on Bitbucket (SUCCESS, not SUCCESSFUL), or the difference is documented
- [ ] The GitHub host and git-local share one runner for the ENOENT/ENOBUFS/ETIMEDOUT mapping instead of two copies
- [ ] prChecks and listPullRequests say when the statuses or pull request list was cut at its limit
- [ ] The Bitbucket diff size limit counts bytes (Buffer.byteLength), not characters
- [ ] getPullRequest by head finds the open pull request beyond the first page of 50
- [ ] listDeploys returns its cut flag with the read instead of the deploysCut side channel
- [ ] toPullRequest, toRun and the listDeploys mapping are below complexity 11
- [ ] link-repo --git-host github on a bitbucket.org remote refuses as init does; link-repo reads Bitbucket only when git_host changes; init --update does not keep a repo of another host
- [ ] Tests: init --dry-run --git-host bitbucket; token absent from AUTH and NOT_CONFIGURED CLI errors; runbook Expects fully asserted (step 8 note, step 9 log text); deploys list text with null parts on GitHub
- [ ] Small cleanups: non-string git_host.repo gives one problem; schema repo description names workspace/repo_slug; the write 3xx next step; inbox --login help names Bitbucket
