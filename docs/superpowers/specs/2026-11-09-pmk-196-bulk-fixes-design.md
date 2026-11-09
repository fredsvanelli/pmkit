# PMK-196: bulk labels, single-issue errors and the commit-only failure

Follow-up of PMK-56 (`issues bulk`, PR #105). Files: `commands/issues/bulk.md`, `scripts/lib/bulk.mjs`, `scripts/pmkit.mjs` (`runBulk`), `scripts/cli-bulk.test.mjs`, `scripts/bulk.test.mjs`. Non-goals: anything in `docs/superpowers/epc-6-follow-ups.md`.

Choices made without a human (autonomous run, recorded so the reviewer can overrule them):

1. **Commit-only failure.** The CLI wraps an `auto_commit` failure after a full success as an error that carries `written` (`applied`, no `failed`). Step 7 of `bulk.md` reads "stopped midway" only when `result.failed` is present. With `applied` and no `failed`, every write landed and only the commit failed: say so, show `applied`, tell the user to commit `.issues/` by hand, and do not offer a new dry run.
2. **Labels are trimmed** in `label-add` and `label-remove` (`" a"` is `a`). An empty value after trim is refused as `bulk <kind> needs a value`.
3. **Remove accepts a comma.** `label-remove "ui, web"` removes exactly that existing label (after trim), so a label created on Linear with a comma can be removed. `label-add` still refuses a comma: `issues update --label` splits on it, so the label could not be read back as one.
4. **A one-issue batch keeps the operation's code.** `runBulk` wraps the shared error of `valueError` as `INVALID_INPUT` for a batch of two or more (the value is wrong). For exactly one issue the error stays the issue's own, so `NOT_FOUND` and `CONFLICT` keep their code.
5. **`--text` of spaces is refused** by `checkBulkFilter` (flags and saved views), with the same "must not be empty" message as `--text ""`.
6. **Next step for a filter with no criterion** depends on the source: flags get `--label legacy`; a saved view gets "save the view again with a criterion (`pmkit views save <name> --label ...`) or pass filter flags instead of `--view`", because the CLI refuses `--view` with filter flags.
7. **Sort test** compares the preview order with the order the view's `sort` gives (priority: B high first, then A, D by created), no `.sort()` on either side, and a view without the sort is shown to differ.

Acceptance: each criterion has a failing test first; `npm test` exits 0; CHANGELOG line; README and `commands/issues/bulk.md` agree.
