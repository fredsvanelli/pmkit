# PMK-203 design: the fallback and incomplete paths of `goals overview`

Source: second review of PR #116 (PMK-67), spec `2026-11-07-pmk-67-initiatives-and-goals-design.md`. Small change, decided without questions (orchestrated run); each call below is mine.

## Decisions

1. **Epic problems only count when an epic is part of the answer.** `listGoals().problems` mixes goal, epic and (new) stray-file problems. On the `goals` path a broken epic may link to a goal, so it stays a warning and makes `complete` false (unchanged). On the `top_level` fallback no epic is part of the answer (a top-level issue's parent may be an epic only by id), so epic problems are dropped from `warnings`. Issue-file problems still count.
2. **A file in `.issues/goals` that is not a goal is not a goal problem.** `listGoals` reports a stem that is not a goal id with `kind: 'file'` instead of `kind: 'goal'`, so it no longer counts as an unreadable goal and the fallback runs. `goals overview` shows it as a `note:` (`ignored ...`), never as a warning, because it is not part of the answer. `goals list` and `validate` still report it.
3. **Archived and unparseable parents.** The fallback reads with `archived: true`, so `topLevelRollup` sees archived parents: their live children are no longer top-level and land in `unreached`. `topLevelRollup(issues, { unreadable })` also takes the ids of issue files that did not parse (from `found.problems`); a child whose parent is in that set is not top-level and lands in `unreached` too. The warning names all three causes (parent cycle, archived parent, parent file that did not parse). `unreached` already makes `complete` false.
4. **Command file.** The "needs an epic" line applies only when `complete` is true: a goal with no epic read as incomplete may have its epic in an unread file. Steps 4 and the "If something is missing" entry say so.
5. CHANGELOG line, README/SKILL untouched (no new command). The PMK-67 spec gets the three rules.

## Non-goals

`docs/superpowers/epc-6-follow-ups.md` items. Linear: `listGoals` is `NOT_SUPPORTED` there, so only the archived read and the unparseable-parent rule apply, and `searchIssues({archived: true})` is already supported.
