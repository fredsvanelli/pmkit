Review of the pull request #7 against the acceptance criteria.

1 partly, 1 gap, 1 failing check.

Checks:
- gap: the check test fails (run https://github.com/o/r/actions/runs/42, step "Run tests").

1. gap: the diff holds no test for the last page.
2. partly: src/events.mjs adds the cursor parameter, but the check test fails on it.

The diff was cut at 2000 lines and read file by file: src/big.mjs.

Outside the criteria: src/big.mjs adds a generated table.
