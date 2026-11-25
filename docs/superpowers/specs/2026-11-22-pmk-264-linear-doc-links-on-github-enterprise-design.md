# PMK-264: link issue docs on a GitHub Enterprise host

## Problem

PMK-252 links a Linear issue's doc to its file on GitHub with `https://github.com/<repo>/blob/<branch>/<path>` (`docUrl` in `scripts/lib/linear/issue-ops.mjs`). A repository on GitHub Enterprise Server gets a link to github.com, which is broken. `git_host` in `.pmkit/config.yaml` holds `system`, `repo` and `default_branch` only, no host.

## Approaches

1. **The web host of the `origin` remote, when that remote is the configured repo; github.com otherwise** (chosen). The CLI already reads `origin` for `/pmkit:setup` and `/pmkit:link-repo` (`parseRemoteUrl`), and the remote is where the repository lives. No config change.
2. A new `git_host.host` key. A config change every GHES user must make, for one link; the remote already says it.
3. Ask `gh` for its default host. `gh` may be logged in to several hosts, and its default need not be this repository's.

## Design

- `scripts/lib/git-remote.mjs` exports `webHost(url, repo) -> string | null`: the host of a remote URL when the URL parses, its owner/name equals `repo` (ignoring case), and the host has a dot; GitHub's own aliases (`www.github.com`, `ssh.github.com`) give `github.com`. Anything else is `null`: a remote of another repo, an SSH alias such as `work` (no dot, not a web host), a URL that does not parse.
- `scripts/pmkit.mjs` `issues update` on Linear with `--add-doc` reads `git remote get-url origin` once, next to the default branch, and passes `docsHost: webHost(url, git_host.repo) ?? 'github.com'` to `updateIssue`.
- `docUrl(path, branch, host = 'github.com')` builds `https://<host>/<repo>/blob/<branch>/<path>`; `updateIssue` takes `docsHost` and passes it through `docChange`. A caller without git (tests, the contract suite) keeps github.com.
- The hand-made-attachment check compares the link built on that host, so it stays right on GHES.

Tests: `scripts/git-remote.test.mjs` for `webHost`: `git@ghe.example.com:acme/app.git` → `ghe.example.com`; `https://github.com/acme/app` and `git@ssh.github.com:acme/app.git` → `github.com`; another repo, an alias `work:acme/app` → `null`. CLI (`scripts/cli-degraded.test.mjs`): an `origin` on `ghe.example.com` gives `https://ghe.example.com/acme/app/blob/...`; an `origin` on github.com keeps the github.com link (the existing test). CHANGELOG.

## Interview

- Live check: no GHES host exists, so it is skipped and recorded in the PR; the URL shape `https://<host>/<owner>/<repo>/blob/<branch>/<path>` is GHES's documented file URL.
- A GHES behind a custom port in an `https://` remote: `parseRemoteUrl` reads the hostname only, so the link drops the port. ponytail: rare; add the port when someone needs it.
- GitHub Enterprise Cloud with data residency (`<sub>.ghe.com`): its remote host is the web host, so it works the same.
- New terms or ADRs: none.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
