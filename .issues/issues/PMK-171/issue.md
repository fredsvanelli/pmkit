---
id: PMK-171
title: Fix the open security findings in the Linear adapter and user store
type: bug
status: backlog
priority: high
estimate: 5
related: [PMK-32]
created: 2026-10-29T02:47:18.284Z
updated: 2026-10-29T02:47:18Z
---

## Description

Security findings from the EPC-5 reviews that are still open on main. Each item names the file, the problem and the fix.

1. scripts/lib/linear/client.mjs:89-102. `secretKeyPaths` reports the path of a secret-like key, but it never checks the key name itself. A key pasted as a YAML key appears in the error message built at client.mjs:254. Fix by naming such a path with a placeholder instead of the key text.
2. scripts/lib/user-store.mjs:173-181. `cacheDelete` and `cacheClear` skip `assertOutsideRepo`, so a `PMKIT_HOME` inside a repository gets a recursive `rmSync` there. Fix by calling `assertOutsideRepo` on the path before each removal.
3. scripts/lib/user-store.mjs:124. `mkdirSync` sets mode 0700 only for new folders, so an existing store folder stays 0755. Fix by calling `chmodSync(dir, 0o700)` on write.
4. scripts/lib/linear/verify-api.mjs:86-89. `assertQuery` refuses only a document that starts with `mutation`, so `query A {a} mutation B {b}` or a subscription passes. Fix by reusing `isMutation` from client.mjs and refusing subscriptions.
5. scripts/lib/linear/verify-api.mjs:95. The `fetch` call has no timeout. Fix by passing `signal: AbortSignal.timeout(...)`.
6. scripts/lib/user-store.mjs:87. `Bearer\s+\S+` rejects ordinary text such as "Bearer auth". Fix by requiring a token-like run, for example 20 or more token characters.

## Acceptance criteria

- [ ] A secret-like key used as a YAML key never appears in the error message from the Linear client
- [ ] `cacheDelete` and `cacheClear` refuse a path inside a repository and remove nothing
- [ ] An existing store folder is set to 0700 on the next write
- [ ] `verify-api` refuses a document with a mutation or a subscription at any position
- [ ] `verify-api` aborts a request that exceeds its timeout and reports it
- [ ] The cache accepts the text "Bearer auth" and still rejects a Bearer token
