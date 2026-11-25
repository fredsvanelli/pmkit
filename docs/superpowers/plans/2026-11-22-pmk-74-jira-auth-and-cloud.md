# PMK-74 Jira authentication and Cloud only: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (small task, per AGENTS.md) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the Jira decisions (Cloud only, API token from the environment, one space per repository) in ADR 0013, checked by a test.

**Architecture:** Docs only. One ADR in the shape of ADR 0005 and ADR 0007, one `node:test` file in the shape of `scripts/adr-linear-auth.test.mjs`. The glossary terms Site and Space were added in Interview (commit 8c6902ee); the test also checks them.

**Tech Stack:** Markdown, Node 18 `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-74-jira-auth-and-cloud-design.md`

## Global Constraints

- ADR file: `docs/adr/0013-jira-cloud-only-with-an-api-token-from-the-environment.md`.
- Variables: `JIRA_EMAIL`, `JIRA_API_TOKEN`. Config keys: `tracker.scope.site` (full host), `tracker.scope.space` (space key).
- Header: `Authorization: Basic base64(email:token)`. Data Center: `NOT_SUPPORTED` from `serverInfo.deploymentType`.
- Data Center end date: 2029-03-28. Token lifetime: at most 365 days.
- No real token in any ADR or in CONTEXT.md. No code change outside the test.
- Plain prose, no em dashes in new text, matching existing ADRs.

## Review Focus

- A real Atlassian token pasted into a doc: the test rejects strings shaped like a classic Atlassian token (`ATATT3` followed by 20 or more token characters) in every ADR and every line of CONTEXT.md.
- The ADR claims scoped tokens work: the test requires the ADR to name `api.atlassian.com/ex/jira` and PMK-75 as the live check.
- The ADR drops a rejected option: the test checks Data Center, OAuth 2.0 (3LO), `acli`, keychain and several spaces under Considered options.
- A dependent issue misses its duty: the test checks PMK-75, PMK-76 and `/pmkit:setup` under Consequences.
- An ADR claims a follow-up issue exists: the test rejects "follow-up issue", as ADR 0005's test does.

---

### Task 1: ADR 0013 and its test

**Files:**
- Create: `scripts/adr-jira-auth.test.mjs`
- Create: `docs/adr/0013-jira-cloud-only-with-an-api-token-from-the-environment.md`

**Interfaces:** none. The test reads files only.

- [ ] **Step 1: Write the failing test** `scripts/adr-jira-auth.test.mjs`, with these tests (helpers `adr()`, `context()`, `options()`, `consequences()` as in `scripts/adr-github-auth.test.mjs`):
  - `ADR-0013 exists`: the file exists.
  - `ADR-0013 has a title, Considered options and Consequences`: first line `^# \S`, both headings present.
  - `ADR-0013 chooses Jira Cloud only and refuses Data Center`: names `Cloud`, `serverInfo`, `deploymentType`, `NOT_SUPPORTED`, `2029-03-28`.
  - `ADR-0013 reads the token from the environment as Basic auth and stores no credential`: names `JIRA_EMAIL`, `JIRA_API_TOKEN`, `Basic`, `scripts/lib/jira/credential.mjs`; matches `/stores no credential/`.
  - `ADR-0013 pins the site and one space`: names `tracker.scope.site`, `tracker.scope.space`, `company-managed`, `team-managed`.
  - `ADR-0013 says tokens expire and leaves scoped tokens to a live check`: names `365`, `api.atlassian.com/ex/jira`, `PMK-75`.
  - `ADR-0013 names each rejected option`: `options()` matches `/Data Center/`, `/3LO/`, `/acli/`, `/keychain/i`, `/several spaces/i`.
  - `ADR-0013 consequences name every dependent issue and setup`: `consequences()` includes `PMK-75`, `PMK-76`, `/pmkit:setup`.
  - `ADR-0013 does not claim a follow-up issue exists`: no match for `/follow-up issue/i`.
  - `no ADR and no line of CONTEXT.md holds an Atlassian token`: `/ATATT3[A-Za-z0-9_=-]{20,}/` matches no ADR file and no CONTEXT.md line.
  - `CONTEXT.md defines Site and Space with their config keys`: `**Site**:` next line has `tracker.scope.site`; `**Space**:` next line has `tracker.scope.space`.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/adr-jira-auth.test.mjs`
Expected: FAIL on the ADR tests (file missing); the CONTEXT.md and token tests pass.

- [ ] **Step 3: Write ADR 0013** from the spec's Approaches, Design, Risks and "Decisions from the owner": title stating the decision, context and choice in prose, `## Considered options`, `## Consequences` (security rules, site pin, error mapping, authorship, PMK-75, PMK-76, PMK-77 to PMK-80, `/pmkit:setup`, cost, what is left open: scoped tokens, Bitbucket Cloud credential in PMK-81).

- [ ] **Step 4: Run it and see it pass**

Run: `node --test scripts/adr-jira-auth.test.mjs && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit** test first, then the ADR, each with `(PMK-74)` in the message.

### Task 2: Tick the acceptance criterion

- [ ] Run `node scripts/pmkit.mjs issues update PMK-74 --check 1 --dry-run --json` (or the flag `issues update --help` names for ticking a criterion), then without `--dry-run`, and commit `chore: tick the PMK-74 criterion (PMK-74)`.
