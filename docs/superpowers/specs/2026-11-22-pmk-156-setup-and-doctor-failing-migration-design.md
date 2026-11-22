# PMK-156: guide setup and doctor through a failing migration

## Root cause

Found in PMK-118 and PMK-119. Since PMK-118 (and PMK-157), `validate` lists a failing migration step or a missing migration as a problem with code `migration` at `<tracker path>/config.yaml`. The command files did not follow:

1. `/pmkit:local:doctor` step 3 handles `config` and `FORMAT` problems before any fix, but has no branch for `migration`. The tracker cannot be read at the current format until the migration runs, so every CLI fix of steps 4 and 5 fails, and nothing tells the user what to do.
2. `/pmkit:setup` "Existing config" step 2 says "a problem in `.issues/config.yaml` or `.pmkit/config.yaml` makes `init --update` refuse". The code (`runInit` in `scripts/pmkit.mjs`) refuses only when `.pmkit/config.yaml` is not valid (`pmkitConfigRefusal`) or `.issues/config.yaml` does not parse or breaks its own rules (`validateLocalConfig`), which `validate` reports as `config` (or `conflict`) problems. A `migration` or `FORMAT` problem sits at the same path and does not make `init --update` refuse, but it does stop every other command. Step 2 treats them all alike, and sends a `migration` problem to a hand edit of `config.yaml`, which cannot fix it.
3. `validate` and `loadConfig` answer an unsupported `tracker.system` (`jira`, `gitlab`, `azure-devops`) with "set it to local". When the tracker folder has no `config.yaml` (a repository set up for another tracker), that edit leaves no tracker: the next command, `validate` included, answers `NOT_CONFIGURED` (`no config.yaml in .issues`), and `/pmkit:setup` takes its "Existing config" path, whose `init --update` refuses for the same missing file. The way out is to move `.pmkit/config.yaml` aside and run setup's first run, which writes both files.

## Goal

Doctor and setup read a `migration` problem by its code and say what fixes it; setup step 2 says which codes make `init --update` refuse; doctor's advice for an unsupported tracker never leaves the repository without a tracker.

## Approaches

1. **Branch by problem code in both command files (chosen).** Doctor step 3 gains a `migration` bullet; setup step 2 splits the problems by code: `config` and `conflict` in either config file (refuses), `FORMAT` and `migration` (setup goes on, the user runs doctor or `/pmkit:upgrade` for the tracker), the rest (stay until fixed). Doctor's `config` bullet gets the clause for the unsupported tracker.
2. Change the CLI message of the unsupported tracker to depend on whether the tracker folder exists. `unsupportedTracker` has no root; `pmkitConfigMessages` is shared by `loadConfig` and the write refusal. The message would need a root threaded through three callers for one wording, while the command file can check the file itself.
3. Make `init --update` refuse on `migration` and `FORMAT` too, so the old sentence becomes true. Setup would then block on a problem it does not need to block on, and the user could not refresh templates until a migration bug is fixed.

## Design

- `commands/local/doctor.md`, step 3, a bullet after `FORMAT`:
  - `migration` problems: the tracker files cannot be read at the current format until the migration runs. When the message says `this pmkit has no migration from tracker format <n> toward format <m>`, tell the user to run `/pmkit:upgrade`, and go to step 6. When it says `migration <n> to <m> failed: <reason>`, show the reason: it names what the step could not convert. The command does not edit tracker files: the user fixes or restores (`git restore`) what the reason names, then ask with `AskUserQuestion` to continue and run `validate --json` again. While a `migration` problem remains, stop, say the CLI fixes need a readable tracker, and go to step 6.
- `commands/local/doctor.md`, step 3, `config` bullet: when the message says `tracker.system "<x>" is not supported yet, set it to local`, check whether `<tracker path>/config.yaml` exists. When it does, setting `tracker.system: local` is the fix. When it does not, setting it alone leaves no tracker: tell the user to move `.pmkit/config.yaml` aside and run `/pmkit:setup`, which writes both files.
- `commands/setup.md`, "Existing config" step 2: show each problem with its path, code and message, then by code: `config` or `conflict` in `.issues/config.yaml` or `.pmkit/config.yaml` make `init --update` refuse, so the user fixes that file first (see `/pmkit:local:doctor`) and the check runs again; `FORMAT` or `migration` do not stop the update, but every other command refuses until `/pmkit:local:doctor` (an older format, a failing migration) or `/pmkit:upgrade` (a newer format, a missing migration) settles them, so say so; other problems do not stop the update and stay until the user fixes them.
- `scripts/scenarios.test.mjs`: static tests that pin the three clauses, in the style of the PMK-122 and PMK-123 ones (the scenario harness cannot make a shipped migration fail: every shipped step succeeds on the fixtures).
- CHANGELOG.

## Interview

- Can a scenario run a failing migration? No: the scenario harness runs the real CLI with the shipped `MIGRATIONS`, which chain cleanly. `scripts/migrations.test.mjs` covers the CLI side (PMK-118, PMK-157); the command files get static tests.
- Does `/pmkit:upgrade` step 5 need a change? That is PMK-158.
- Does a `conflict` in `.issues/config.yaml` make `init --update` refuse? Yes: the file does not parse (`parsedLocal`).
- New terms or ADRs: none.
- Approval: the issue names the three gaps; the reading of `init --update` comes from the code. pmkit PO approves.
