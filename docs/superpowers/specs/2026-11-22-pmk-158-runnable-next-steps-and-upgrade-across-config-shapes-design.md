# PMK-158: make next steps runnable and keep upgrade working across config shapes

## Problem

Found in PMK-118 and PMK-120.

1. **Next steps that name a CLI command have no runnable form.** About 60 `PmkitError` next steps read `pmkit cycle list`, `pmkit validate`, `pmkit epic list`, and so on. No `pmkit` executable exists: the CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs"` in a command file and `node scripts/pmkit.mjs` in the README. The conventions say "offer to run it when it is a command" without saying how, so an agent either runs `pmkit ...` (command not found) or guesses. Nothing checks that the named command exists either.
2. **`/pmkit:upgrade` step 5 would be blocked by a change to the shape of `.pmkit/config.yaml`.** Step 5 runs the new version's `migrate`. Since PMK-120, `runMigrate` refuses when `.pmkit/config.yaml` has a problem (`pmkitWriteRefusal`, "before every other check"). A pmkit release that adds a required key or renames one would see the old file as invalid, and its own `migrate` would refuse, so the upgrade could not move the tracker. `migrate` reads only `tracker.system` and `tracker.path` from that file and writes only tracker files, so the refusal protects nothing there.

## Goal

An agent turns any `pmkit <command>` next step into a call that runs, a test keeps every such next step pointing at a real command, and `migrate` (so `/pmkit:upgrade` step 5) runs whatever else `.pmkit/config.yaml` holds, as long as it can find the tracker.

## Approaches

For 1:

1. **One conventions rule and a test (chosen).** A next step that starts with `pmkit ` (or `node scripts/pmkit.mjs `) names a CLI command: run it as `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" <the rest> --json`; text after `;` or a comma explains it and is not part of the call. A test scans the CLI sources for next steps that start with `pmkit ` and checks the command after it is in `COMMANDS`.
2. Rewrite every next step to `node scripts/pmkit.mjs ...`. Sixty strings and their tests change, and the path still runs only from the plugin root, not from the user's repository.
3. Add a machine field (`nextCommand: ['cycle', 'list']`) to the error JSON. Every error site changes for a rule one line in the conventions covers.

For 2:

1. **`migrate` warns about `.pmkit/config.yaml` problems instead of refusing (chosen).** It still needs `tracker.system: local` and a readable `tracker.path`, which `loadConfig` checks before (`NOT_SUPPORTED`, `INVALID_INPUT`). The warning is the read warning every other reader prints, so the user learns the file needs `/pmkit:setup` after the migration.
2. Keep the refusal and have `/pmkit:upgrade` run `/pmkit:setup` first. `init --update` also refuses an invalid `.pmkit/config.yaml` ("Fix .pmkit/config.yaml by hand"), so a shape change would still block.

## Design

- `skills/pmkit/references/conventions.md`, "Reading errors", the `nextStep` bullet: the runnable form above, and that a next step starting with `/pmkit:` is a command file to offer.
- `scripts/plugin.test.mjs` (or a new `scripts/next-steps.test.mjs`): every string literal that is the third argument of `new PmkitError(` or the second of `usageError(` / `invalid(` in `scripts/pmkit.mjs` and `scripts/lib/**/*.mjs`, when it starts with `pmkit `, names a CLI command: the longest name of `COMMANDS` it starts with must exist. The test lists the misses.
- `runMigrate` in `scripts/pmkit.mjs`: `config.pmkitProblems` become `warnings: [pmkitConfigWarning(problems)]` on the result (dry run and real run), not a throw. The CLI prints them on stderr as `warning:`.
- `scripts/migrations.test.mjs`: the PMK-120 test `migrate refuses an invalid .pmkit/config.yaml before every other check` becomes `migrate warns about an invalid .pmkit/config.yaml and still checks and migrates the tracker`: the git_host problem gives the warning, and each of the three repositories gets the answer it would get with a valid file (a plan and a migration, nothing to migrate, `NOT_CONFIGURED`).
- `commands/upgrade.md` step 5: show the `warning:` about `.pmkit/config.yaml` when the migrate result has it, and in step 6 suggest `/pmkit:setup` for it.
- CHANGELOG.

## Interview

- Does any next step start with `pmkit ` and name no command today? The test will tell; the tally found `pmkit epic get shows the documents of an epic`, whose command is `epic get` followed by prose, which passes.
- Is warning instead of refusing safe for `migrate --dry-run`? It writes nothing either way.
- Does the CLI's own write refusal (`run`) need a change? No: it already leaves `migrate` out and lets `runMigrate` decide.
- `tracker.system` other than `local`: `migrate` keeps `NOT_SUPPORTED` (the `local: true` check in `run`).
- New terms: none. ADR: none, the refusal was a per-command rule of PMK-120 and this narrows it for one command that reads no other setting.
- Approval: the issue names both gaps; the choices follow the code. pmkit PO approves.
