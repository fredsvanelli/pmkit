---
id: PMK-170
title: Reject credential-shaped keys in repo configs with validate
type: feature
status: backlog
priority: medium
estimate: 3
related: [PMK-32]
created: 2026-10-29T02:47:18.185Z
updated: 2026-10-29T02:47:18Z
---

## Description

`pmkit validate` checks the shape of `.pmkit/config.yaml` and `.issues/config.yaml` but does not flag keys that look like credentials. The Linear client refuses such a key at run time (`secretKeyPaths` in scripts/lib/linear/client.mjs:89), and the user store rejects them in its own files (`isCredentialKey` in scripts/lib/user-store.mjs:90). A secret that sits in a committed config is found only when a Linear command runs, and never for other trackers.

Make `validate` report every credential-shaped key or value in both repo configs, with the path and no value, using the same rules as `isCredentialKey` and `isCredentialString`. Reuse those functions instead of copying the patterns.

## Acceptance criteria

- [ ] `validate` lists each credential-shaped key in `.pmkit/config.yaml` and `.issues/config.yaml` with its path
- [ ] `validate` lists a credential-shaped string value with its path and never prints the value
- [ ] A repo config without such keys still validates with no new problem
- [ ] Tests cover a key, a value, a nested key and a clean config
