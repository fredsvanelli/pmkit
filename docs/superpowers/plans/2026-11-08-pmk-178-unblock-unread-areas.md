# PMK-178 plan: `pr blockers` with unread areas

Spec: `docs/superpowers/specs/2026-11-08-pmk-178-unblock-unread-areas-design.md`. Each task is test first (`scripts/pr-blockers.test.mjs`, `scripts/github-host.test.mjs`).

1. **Refusal classification** (`scripts/lib/github/host.mjs`). Test `failure()` through `prChecks`/`prThreads`: a SAML message and a missing-scopes message (plain stderr and graphql `INSUFFICIENT_SCOPES`) get `httpStatus` 403; a message that only mentions scopes mid-text does not. Implement the anchored match and the `prThreads` type map.
2. **Change request** (`scripts/lib/pr-blockers.mjs`). Tests: `APPROVED` makes it pending; required count 0 makes it pending; count 1 without `APPROVED` still blocks; protection unread without `APPROVED` stays unknown. Implement.
3. **Unevaluated rules** (`pr-blockers.mjs`). Tests: checks refused, reviews refused and threads refused with the policies read give `policies.unevaluated`, a `policies:` line without `all met`, and a BLOCKED message naming them; collectBlockers via the real host with a SAML refusal gives `unchecked`. Implement `unevaluated`, the text and the message.
4. **Docs.** `CHANGELOG.md` line under `## Unreleased`. Check `commands/issues/unblock.md`, README and goldens/scenarios for the `policies:` wording.
5. **Verify.** `npm test` in the foreground, exit code 0. Tick the three criteria with `issues update PMK-178 --check n` (dry-run, then real), commit `.issues/`.
