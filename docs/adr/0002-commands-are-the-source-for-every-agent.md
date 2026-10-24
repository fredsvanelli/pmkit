# Commands are the source for every agent

pmkit's behavior lives in Markdown commands under `commands/**`, each a procedure for one dev, PM or EM workflow, user-invoked (`disable-model-invocation: true`) and with a `## Parameters` section. We copied the layout of the `runbooks` plugin. Subfolders give three-level names: `commands/issues/create.md` is `/pmkit:issues:create`, as `/runbooks:roles:create` already shows. One routing skill, `skills/pmkit/SKILL.md`, maps natural-language requests to the command files, so a request in plain words reaches the same procedure as the slash command.

Commands never compute and never edit `.issues/` by hand. For every computation and every write they run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" <command>`. The CLI is the only entry point, so validation, the event log and `--dry-run` behave the same whichever agent calls it.

Codex and OpenCode do not read Claude Code plugins. For them, a packaging script (`scripts/package.mjs`, phase 3) generates one skill folder per command, named `pmkit-<group>-<action>`, whose `SKILL.md` carries the command's description and procedure. An MCP server serves the same CLI operations. The generated files are output, never edited. A fix to a procedure goes in the command, and the next packaging run carries it to every agent.

## Considered options

- Write a separate skill set for each agent. Rejected: three copies of every procedure drift apart.
- Let commands describe the operations and have each agent call tracker tools directly. Rejected: the validation and the event log would live in prose, and two agents would write different files.

## Consequences

- Claude Code needs no generated files. The packaging script and the MCP server are later build steps, and until they ship only Claude Code can use pmkit.
- A command that needs a computation the CLI lacks has to wait for a CLI change, because a command cannot do the work itself.
