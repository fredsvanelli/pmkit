# PMK-200: view errors carry a stable reason

Source: PMK-200 (follow-up of PMK-54, PR #107). Scope: the three `INVALID_INPUT` errors of `views run`, `commands/issues/run-view.md` step 4 and its scenarios.

## Problem

`views run` answers `INVALID_INPUT` for three different causes, and step 4 tells them apart by searching `error.message` for a phrase. Rewording a message breaks the command and no test fails. The step-4 error branches and the Linear branch have no scenario.

## Decisions

1. **Reasons.** `PmkitError.details.reason` holds a stable string:
   - `invalid_view_name`: the name breaks the name rule (`requireViewName`).
   - `view_out_of_date`: the stored filter names a type, member, sprint or label the tracker no longer has (`runView`).
   - `view_file_broken`: the file does not parse or has no `filter` map (`parseView`).
   The reason is part of the CLI contract; messages stay free to change. These are the only reasons, so no registry is added.
2. **Output.** With `--json` an error with `details.reason` prints `error.reason`. Other errors are unchanged. Text mode is unchanged.
3. **Command.** Step 4 reads `error.reason` instead of a phrase of `error.message`. `NOT_FOUND` and `NOT_SUPPORTED` still branch on the code.
4. **Tests.** A unit test pins each reason (a message reword cannot change it). A CLI test pins `error.reason` in the JSON. `issues/run-view` gets one scenario entry per branch of step 4 (not found, invalid name, out of date, broken file) and one for the Linear branch of step 1.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`. Reasons for other commands' errors.
