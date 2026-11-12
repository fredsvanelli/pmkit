# PMK-292: read an empty list item and a long ordered marker as CommonMark does

## Intent

PMK-291 (PR #241) rewrote the end of the `## Status` section in `scripts/lib/adr.mjs` (`sectionEnd`, a CommonMark block stack). That change already gives the behaviour PMK-292 asks for. The gap is that no test pins it for the two cases the issue names. This issue adds those tests. It changes no code.

## Decisions (made without questions, per the orchestrator brief)

- **No change to `scripts/lib/adr.mjs`.** Probed with the module: `Accepted\n\n-\nfoo\n===` and `...\n---` give `Accepted -`; `Accepted\n\n1234567890. a\nb\n---` gives `Accepted`; `123456789. a` after a blank line is still a list item and keeps the section open. All match the issue. If a test showed otherwise, work would stop and a PERGUNTA would go to the coordinator.
- **Tests go in `scripts/adr.test.mjs`**, after the PMK-291 tests, and follow their style: each case runs through `adrInfo`, `setAdrStatus`, and the CLI (`docs adr-get`, `docs adr-status`).
- **Coverage per criterion:**
  1. Empty item (`-`, `*`, `1.`) followed by a line and an underline of `===` or `---`: the section ends at that line. The PMK-291 test already covers `-` with `===` through the CLI; the new test adds the `---` underline and the other markers.
  2. A 10-digit ordered marker is paragraph text: `Accepted\n\n1234567890. a\nb\n---` ends the section at the paragraph start (`Accepted`). Under the status text with no blank line, the underline takes the text with it and the status is null, the same rule as PMK-273.
  3. The 9-digit limit: `Accepted\n\n123456789. a\nb\n---` is a list item and the section stays open (`Accepted 123456789. a b ---`), so the 9-digit cap is the boundary between the two cases.
- **CHANGELOG** line under `## Unreleased`, saying it is test-only and citing PMK-291.
- **No README or SKILL.md change**: no new command.

## Non-goals

- Other list cases (the issue's out-of-scope list).
- Any change to how `setAdrStatus` writes.

## What is left to the builder

Nothing beyond the three test cases above.
