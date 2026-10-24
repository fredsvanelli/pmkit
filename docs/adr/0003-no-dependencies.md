# pmkit has no dependencies

pmkit's scripts are Node 18+ ES modules with no dependency, in `dependencies` or `devDependencies`, like `runbooks/scripts/`. Tests use `node:test`. Plugins install independently from the marketplace, so a plugin cannot assume the repository's other folders or a `node_modules` next to it. A dependency would need an install step, a lockfile and updates for a plugin that is a folder of Markdown and scripts. `plugin.test.mjs` fails if `package.json` gains either key.

## Considered options

- Use a YAML library, an MCP SDK and the GitHub API client.

## Consequences

- YAML is a subset. pmkit keeps its own copy of the parser from `runbooks/scripts/lib/yaml.mjs`, because plugins install independently. It reads block maps, block lists of scalars, flow lists, flow maps, quoted and plain scalars and comments. It has no list of maps, so members, statuses and capacity are maps keyed by id.
- The MCP server for Codex and OpenCode will be written by hand against the protocol, not with the SDK.
- The GitHub git host calls the `gh` and `git` CLIs instead of an API client. It needs `gh` installed and logged in, it holds no token, and it parses `--json` output. The `gh` output shape is the adapter's dependency, and a change there breaks the adapter.
- Small helpers that a library would give are written and tested in the plugin, such as the CRLF and BOM readers and the Crockford base32 ID generator.
