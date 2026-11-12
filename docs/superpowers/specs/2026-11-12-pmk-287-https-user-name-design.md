# PMK-287: redact the user name of an http(s) URL in `hideAbsolutePaths`

## Problem

`hideAbsolutePaths` keeps a `scheme://host` URL whole and runs it through `redact(url).text`, which hides `user:password@` and tokens but not a bare user name: `unable to access 'https://bob@host/r.git/': 403` shows `bob`.

## Decision (autonomous, no questions)

- Small change, written design kept short. In the URL branch of `hideAbsolutePaths`, after `redact`, an `http` or `https` URL whose authority holds `user@` shows `[redacted]@`. The user runs to the last `@` before the first `/`, `?` or `#`, so an `@` in the user or in a later query does not leave part of it or change the query.
- `git+https://bob@host` follows the same rule: the scheme test is `(?:<scheme>+)?https?`, the same shape as `FILE_SCHEME`, because it is the same kind of URL. Scheme matching is case-insensitive.
- `ssh://git@host`, `git+ssh://git@host` and `git@host:path` stay as they are (the user is the fixed `git`). `https://host` and `<remote>/<branch>` have no user and stay.
- `redact.mjs` is not changed. Text outside URLs is not changed.
- An already redacted `https://[redacted]@host` is unchanged by a second pass.

## Out of scope

The linear-time rewrite of the regexes (PMK-288).
