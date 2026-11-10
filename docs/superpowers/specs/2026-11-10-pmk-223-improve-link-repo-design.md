# PMK-223: improve link-repo

Source: PMK-223, the PMK-53 items of `docs/superpowers/epc-6-follow-ups.md`. Builds on `2026-10-31-pmk-53-link-repo-design.md` and `2026-11-09-pmk-188-link-repo-fixes-design.md`.

The worker ran without a human in the loop (Orca dispatch). Every choice the issue does not state is marked **(builder's call)**.

## Intent

`link-repo` recognizes only github.com, so a GitHub Enterprise repository needs `--git-host github --repo owner/name` typed by hand; it always asks before writing, even for a one-line host change; and on Linear it never checks the team already in the file. PMK-223 closes the three gaps without changing what the command writes.

## Goals

1. **GitHub Enterprise.** With `--git-host github` and a remote whose host is not github.com, the repo is read from that remote (`owner/name`) instead of being demanded by `--repo`. `--repo` still wins. The repo is read only when the file holds none; when the file holds another repo it is kept and a warning names the remote's. Host (DNS name) and owner/name (GitHub's characters, no leading `-`, not `.` or `..`) are validated first, and a remote that fails is treated as unreadable, with the reason in the refusal. The result says the repo came from the remote (`source: remote`) and a `note:` names the host and that `gh` must be logged in to it (`gh auth login --hostname <host>`). Without `--git-host github` an unrecognized host still changes nothing (PMK-53 rule: only an explicit flag raises or lowers the host) **(builder's call: no new config key; `gh` already resolves the host from the remote, so pmkit needs no host field)**.
2. **Skip the confirmation for a host-only change.** The command file takes `--yes`. The CLI result carries `hostOnly`: `true` when the file changes and the change touches only `git_host.*` lines (no team change, no broken mapping). With `--yes` and `hostOnly: true`, step 6 is skipped. With a team change, a broken mapping or no change, `--yes` does nothing and the command asks as before. `write_policy.confirm: none` still does not skip it **(builder's call: the skip is an explicit per-call opt-in, not a policy)**. The CLI itself never asks, so `--yes` is read by the command file only. `hostOnly` is also `false` when a warning is present, when the host is lowered (`--git-host none` always asks), and when a repo or branch the file holds would be replaced **(builder's call, review of PR 191)**.
3. **Re-check the team in the file.** `--recheck-team` (Linear only) checks the team the file holds (or `--team`'s) against the workspace, as `--team` does, and sets `scope.team.verified: true`; it lists `broken` mappings for that team. An unknown team is `INVALID_INPUT` listing the teams. With no team in the file and no `--team`, it is `INVALID_INPUT` too. On Local it is `INVALID_INPUT`, like `--team`. It writes nothing beyond what the other flags change, and never refuses the write for broken mappings of an unchanged team **(builder's call: the refusal stays for a team change only)**. When the teams or states of the discovery are cut at the client cap, the team is not verified (`verified: false`, a warning, no `broken`), and a team change is refused with `UPSTREAM` and no retry advice, since a cut is not transient. A cut of users or labels does not matter to this check **(builder's call)**.

## Non-goals

- A `git_host.host` config key, or `GH_HOST` handling in `github/host.mjs`.
- Recognizing an Enterprise host without `--git-host github`.
- Changing `/pmkit:setup`.

## Output

`hostOnly` is in the `--json` data and the command file reads it. The Enterprise note and the re-check result (`verified`, `broken`) are in the JSON as well as the text.
