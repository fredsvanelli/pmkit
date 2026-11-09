# PMK-178 design: `pr blockers` when checks, reviews or scopes cannot be read

Source: PMK-178 (follow-up of PMK-62, PR #89). Files: `scripts/lib/pr-blockers.mjs`, `scripts/lib/github/host.mjs`, `commands/issues/unblock.md` if it quotes the policies line.

## Problem

The verdict never says `blocked: false` wrongly, but the text contradicts it:

1. With the checks (or reviews) read refused, the required-checks (or required-approvals) rule is never evaluated, yet the `policies:` line says `all met`. With `BLOCKED`, the text blames "a rule this command does not read", when the cause may be the unread area.
2. `INSUFFICIENT_SCOPES` and SAML refusals are not marked as a refusal (no `httpStatus`), so they fail the whole command instead of marking the area `unchecked`.
3. A `CHANGES_REQUESTED` from one author blocks whenever the protection has a `required_pull_request_reviews` block, even with `reviewDecision: APPROVED`, and a required count of 0 counts as required.

## Decisions

- **Unevaluated rules.** `policies` gets `unevaluated: string[]`, filled when the policies were read but an input was not: `required checks` when `checks` is null, `required approvals` when `reviews` is null, `conversation resolution` when `threads` is null and the protection requires it. (The third is the same defect in the same code, so it is fixed together.)
- **Text.** The `policies:` line never says `all met` while `unevaluated` is non-empty. It lists the unmet rules, then `not checked: <names> (<area> unread)`.
- **BLOCKED.** When `BLOCKED` is the only blocker and `unevaluated` is non-empty, the message names them: `GitHub blocks the merge by a rule this command does not read (for example a ruleset), or by <names>, which it could not evaluate`. The verdict stays `blocked: true` as today.
- **Refusals.** `failure()` in `host.mjs` marks `httpStatus: 403` for a SAML enforcement message and for a missing-scopes message (`INSUFFICIENT_SCOPES`, "has not been granted the required scopes", "missing required scopes"). The match is anchored at the start of the first line (after `gh: `, `GraphQL: ` or `error: `), so free text that names a branch is not a refusal. `prThreads` also maps a graphql error type `INSUFFICIENT_SCOPES` to 403.
- **Change request.** It blocks only when the protection requires at least 1 approval and `reviewDecision` is not `APPROVED`. With `APPROVED`, it is pending. With a required count of 0, it is pending (protection read) as before for no-review protections. With the protection unread and no `APPROVED`, it stays `unknown`.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`; any change to the `blocked` verdict rules beyond item 3.

## Acceptance mapping

1. Criterion 1: `unevaluated`, the text line and the BLOCKED message.
2. Criterion 2: `failure()` and `prThreads` classification.
3. Criterion 3: the change-request branch.
