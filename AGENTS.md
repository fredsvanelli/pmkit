# Agent instructions

## Development Workflow: SPEC-SS

Every task goes through six phases, in order: **S**pecify, **P**lan, **E**xecute, **C**heck, **S**ecure, **S**hip. SPEC builds the change; SS guards it and delivers it. A phase starts only when the one before it is done.

Every tool named in this section is a recommendation, not a requirement. Any plugin, skill or prompt that does the same job can replace it; when one is swapped, update its name here.

Rules for every phase:

- Use `superpowers:systematic-debugging` for any bug or failing test, before proposing a fix.
- Use `superpowers:verification-before-completion` before claiming any phase is done: run the check and read its output first.
- Planning alone does not authorize implementation. Follow the execution scope the user asks for.
- Work started through `/pmkit:issues:work` follows SPEC-SS, and the branch that command creates replaces `superpowers:using-git-worktrees`. After the pull request is open, post the summary comment and move the issue to `in_review` through the pmkit CLI.
- Every commit message carries the issue ID.

### S: Specify (before any code is written)

1. **The issue.** Context, scope and acceptance criteria come from the issue, read through pmkit (`/pmkit:issues:work` and the pmkit CLI).
2. **Q&A session.** `mattpocock-skills:grilling` and `superpowers:brainstorming` sharpen the issue against the PRD and the domain glossary (`CONTEXT.md`). Answer factual questions from the code instead of asking the user.
3. **Terms and decisions recorded.** When a new term or a hard-to-reverse decision comes up, record it with `mattpocock-skills:domain-modeling`: terms in `CONTEXT.md`, decisions as ADRs in `docs/adr/`.
4. **Output: a written design doc** in `docs/specs/YYYY-MM-DD-<slug>-design.md`. The user approves it before planning starts.

### P: Plan

`superpowers:writing-plans` turns the approved design into a plan in `docs/plans/YYYY-MM-DD-<slug>.md`, the design's file name without `-design`. Execution follows the plan.

### E: Execute (TDD)

Implementation follows test-driven development (`superpowers:test-driven-development`): a failing test first, then the code that makes it pass. The execution skill depends on the size of the task:

- Small tasks: `superpowers:executing-plans`, a single agent running the tasks in sequence.
- Medium and larger tasks: `superpowers:subagent-driven-development`, an orchestrator dispatching one subagent per task.

### C: Check

Every user flow the work changes is validated by its runbook in `docs/runbooks/` (the `run` skill). Create the runbook of a new flow, or update the existing one. Before calling the work done, run the runbooks of every flow the work touched. Each runbook is verified by an E2E test script on Node's built-in test runner (`node:test`, run by `npm test`). The project has no dependencies (ADR 0003), so E2E tests use no external test framework. A failing runbook means the work is not done.

### S: Secure

Before each pull request, run `utils:review-work` on the branch. It checks the branch against 12 criteria: spec match, scope and size, readability and conventions, tech debt, unit tests, E2E tests, security, cyclomatic complexity, error handling and edge cases, performance, backward compatibility and documentation. Fix its findings, or report the ones left open, before shipping.

### S: Ship

Ship with `superpowers:finishing-a-development-branch`, only when every check passes. The project's only check is the test suite, `npm test` (`node scripts/run-tests.mjs`); it has no lint, type-check or build step. Open the pull request, then monitor CI (for example with `gh pr checks`). Never merge before every check is green, and never merge without explicit user authorization.

<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
## Learned rules
- Ask in setup whether issue/epic names should be random or numbered; suggest random only for local trackers, numbered for remote ones.
<!-- end claude-reflect -->
