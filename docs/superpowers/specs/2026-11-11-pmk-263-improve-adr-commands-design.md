# PMK-263: improve the ADR commands (design)

Source: the issue's scope and acceptance criteria. No open business question: the issue says what each command does.

## Decisions

1. **`docs adr-get <number>`** (read-only, `byTracker: true`, capability `documents`, same as `docs adr-status`).
   Finds the ADR with `adrByNumber` (so `NOT_FOUND`, `CONFLICT` and `INVALID_INPUT` are the ones `adr-status` gives).
   `data`: `number`, `title`, `status`, `path`, `ref`, `place`. Text: those fields.
   - `title`: the first `# ` heading after the front matter, else the `title:` key of the front matter, else `null`.
   - `status`: the value in the form the ADR uses, read the way `setAdrStatus` reads it (front matter `status:`, then the `## Status` body, then a `Status:` line above the first `##`), `null` when none. When two forms disagree, the first wins and a note lists them, so the command never hides a disagreement.
2. **record-decision uses it** in step 2 instead of `adr-status --dry-run`, for each replaced ADR.
3. **Several replaced ADRs**: step 1 takes a list of numbers; step 4 writes one `Supersedes: ADR <n>, <ref>` line per ADR; step 7 marks each old ADR with its own dry run, shows all previews first, and asks once (more than one record is a bulk change). When a write fails in the middle, step 7 stops, lists the ADRs marked and the ones left, and offers `/pmkit:spec:adr-status` for each one left.
4. **Question and warning tidy-up in record-decision**:
   - step 1 does not ask whether the decision replaces an ADR when the arguments or the user's words already name it;
   - step 3 (after the number is known) warns when a replaced ADR's number is higher than the new one, and asks whether to go on;
   - step 7 starts by saying that step 6 stopped and what failed, before asking to mark the old ADRs.
5. **`validate` with a hosted tracker**: already reports a repeated number in `docs/adr` (PMK-228, test "a hosted tracker still gets the ADR check"). No code change; the acceptance criterion is checked against that test, and a CLI-level test on a Linear config is added.
6. **`adr-status` updates every status line**: when the ADR has front matter or a `## Status` section, a `Status:` or `**Status:**` line above the first `##` is also rewritten (PMK-257 already handles the front matter key and the section). `before` and `after` list every place changed.

## Non-goals

The git stderr in the UPSTREAM message and `--by` relative to the checkout with both ADRs in an outside tracker (PMK-257 left both out).
