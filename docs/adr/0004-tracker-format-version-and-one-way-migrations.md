# The tracker format has one version, and migrations only go forward

The Local tracker's files can change shape in a later release. `.issues/config.yaml` holds one integer `version`, the tracker format. It goes up only when the files change shape, not with each plugin release. The CLI holds one constant, the format it reads and writes. It is 1 today and the list of migrations is empty. `migrate` and the loader take that list as an argument, so tests run them against migrations defined in the tests.

Each migration takes the format from one number to the next, and `pmkit migrate` applies them in order. A migration has no reverse. Git history is the way back, so `migrate` refuses with `NOT_CONFIGURED` outside a git repository, and with `CONFLICT` when the tracker folder has uncommitted changes. `migrate --dry-run` lists every file it would create, change or delete and writes nothing. A teammate on an older plugin keeps working on the same repository, with these rules:

- A repository on an older format than the CLI's can be read. The loader copies the tracker folder to a temporary folder, runs the pending migrations on the copy and reads the copy, so readers only ever see the current shape. Writes refuse with `NOT_SUPPORTED` and the next step `/pmkit:upgrade`.
- A repository on a newer format than the CLI's is refused for reads and writes, with `NOT_SUPPORTED` and the next step `/pmkit:upgrade`.
- A version below 1 is a config problem, not an older format.
- No command migrates on its own. A migration changes many files, so the user runs `/pmkit:upgrade`, sees the full list and approves it.

## Considered options

- Migrate silently on the first write. It surprises a teammate who has not updated the plugin, and it changes many files with no preview.
- Tie the format to the plugin version. Most releases do not change the files, so every release would need a migration or a special case.
- Write reverse migrations. Each one doubles the code to test, and git already restores the old files.

## Consequences

- Readers never carry code for old shapes. Only the migration list does.
- Reading an older format copies the tracker folder on each run, so a large tracker reads slower until it is migrated.
- A release that changes the format adds a `Tracker format: N` line to its changelog section, and the version in `plugin.json` and the changelog stay separate from the format number.
- The `version` key of `.pmkit/config.yaml` is outside migrations. Setup owns that file, and a change to its shape is announced with a `Setup:` line in the changelog.
