# PMK-195: inbox authors, corrupt-file fallback and stale docs

Follow-up of PMK-47 (user inbox, PR #104). Same files: `scripts/lib/local/tracker.mjs` (`scanInbox`, `markRead`), `scripts/lib/local/events.mjs`, `scripts/lib/validate.mjs`, `scripts/pmkit.mjs` (`inbox mark-read`). Goals are the four acceptance criteria plus the other bullets of the issue scope. Non-goals: anything in `docs/superpowers/epc-6-follow-ups.md`.

Choices made without a human (autonomous run, recorded here so the reviewer can overrule them):

1. **Description author is always `null`.** The event log records that the description changed, never the text, so no line has a knowable author. `by` is `null` for every description and criteria item (it was the newest description editor). `at` still orders the list (newest description event); the key does not depend on it. The PMK-47 spec section "What counts" is updated.
2. **Unreadable time is a problem, kept readable.** `readEvents` keeps the event but reports `line N: at "x" is not a time`, so `inbox list` (`complete: false`, `problems`) and `validate` (code `events`) both say so. A comment whose `created` is not a time is a `scanInbox` problem and a `validate` problem (code `comment`). The item still falls back to the file's modified time for ordering. An absent `created` is not a problem (a comment file by hand). `mark-read` already refuses on any problem.
3. **A comment with no frontmatter has `by: null`**, not `""`. A frontmatter without `author` too.
4. **A mention in a body section such as `## Notes`** is `in: description`: only the lines of the criteria list are `acceptance_criteria`. The item vocabulary is a contract PMK-55 reads, so no new value. Decided by the parsed `acceptanceCriteria` of the issue, not by "not in the description".
5. **`mark-read --key` with an unknown key marks the known keys** and reports the others in a new `unknown` array of the result (always present, `[]` when none) and as a `warning:` line in the CLI. Exit 0. The incomplete-inbox refusal stays.
6. **The prune checks other branches.** A seen key of an item missing from the checkout is dropped after 30 days only when the issue is also in no local or remote branch (`git ls-tree` on each ref, run only for prune candidates). Outside git, or when git fails, the check says "not found elsewhere", which is the old behavior.
7. **Docs:** the `markRead` JSDoc says unknown keys are reported, not refused; the test at `inbox-tracker.test.mjs:343` is renamed to match; PMK-47 spec, `commands/issues/inbox-digest.md`, README row for `inbox mark-read`, CHANGELOG line.

Acceptance: each criterion has a failing test first (tracker test and one CLI test); `npm test` exits 0.
