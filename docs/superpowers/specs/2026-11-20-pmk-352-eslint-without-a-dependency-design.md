# PMK-352: ESLint without a dependency, and the unused names it reports

Size: a small change. Issue: `.issues/issues/PMK-352`.

## Intent

The SPEC-SS workflow in `AGENTS.md` makes "lint passes" part of Execute and Ship, and the project had no linter. Unused names had piled up in `scripts/`, and an unused name can hide a check that was meant to run. The work adds a lint command, fixes what it reports, and says in `AGENTS.md` that there is no type check and no CI.

## Goals, non-goals, anti-goals

- Goal: `npm run lint` exits 0 on the repository, and `npm test` still passes.
- Goal: the rules catch real mistakes in plain ES modules (undefined and unused names, unreachable code, duplicate keys and cases, `==`).
- Non-goal: formatting and style rules, a type check, a CI pipeline.
- Anti-goal: a dependency in `package.json`. ADR 0003 forbids one, and `scripts/plugin.test.mjs` fails on `dependencies` or `devDependencies`.
- Anti-goal: deleting an unused name that should have been used. Each one is read before it goes, and a missing check would be fixed, not deleted.

## Approaches

1. **ESLint through `npx`, pinned** (picked by the user). `npm run lint` runs `npx --yes eslint@10.15.0 .` (the latest release, 2026-11-13). Nothing enters `package.json` dependencies, so ADR 0003 holds. Trade-off: the first run downloads ESLint into the npm cache and needs the network. The config cannot import `@eslint/js` or `globals`, because they do not resolve from the repository, so the rules and the Node globals are listed in `eslint.config.js`.
2. **Biome through `npx`.** One binary and fast, with the same no-dependency property. Not picked: ESLint is the more common choice and its rule names are the ones reviewers know.
3. **ESLint as a devDependency.** The usual setup, with a lockfile. Not picked: it needs an ADR superseding 0003 and a change to `plugin.test.mjs`, for one tool.

## Design

- `eslint.config.js` at the root, a flat config that imports nothing. It lints `**/*.mjs` and `**/*.js` as ES modules with the Node globals the code uses, and ignores only the untracked agent folders `.agents/` and `.codex/`, which hold vendored browser scripts. The tracked `.claude/` and `.superpowers/` hold no JavaScript, so they need no entry.
- `no-unused-vars` follows the code's own idioms: `ignoreRestSiblings` for `const { key, ...rest } = obj`, which drops a key on purpose, and `^_` for arguments, variables and array elements kept on purpose. Caught errors are not checked. This takes 44 of the 63 first reports.
- The other 19 are dead names, removed: unused imports, constants, helpers and trailing parameters in 14 files under `scripts/`. None hid a missing check. `LIST_REFS` in `validate.mjs` repeats the list written out where it is used, and the Linear setup scenarios cover the Local paths with other reason strings than the unused `localOnly`.
- `AGENTS.md`: the branch also carries the SPEC-SS workflow section that the user asked for in the same session, which replaces the old phase-based one. Execute is done when `npm test` and `npm run lint` pass. Ship runs both and says the project has no type check, build step or CI. Tech stack gains lines for lint, type check (none) and CI (none).

## Decided in the interview

- Lint stays outside `npm test`: two commands, so the suite keeps running offline on a cold npm cache.
- No ADR: running ESLint through `npx` is one script line and one config file, easy to reverse. The comment at the top of `eslint.config.js` says why the config imports nothing. ADR 0003 stays as it is.
- ESLint is pinned at 10.15.0. It needs Node 20.19 or later (its `engines`), so `npm run lint` does too, while the scripts and `npm test` keep Node 18.
- The Node globals stay a hand-written list. A new global fails lint with `no-undef` until it is added, a one-line fix.
- No new term for `CONTEXT.md`: lint is tooling, not a pmkit domain term.

## Left to the builder

- No new test: the change keeps behavior, and the lint run is its check (it failed with 63 errors before the fix and passes after). `npm test` shows nothing else changed.

## Note for the PR

The code was written before this doc and before a failing check was recorded on the branch. The lint run that failed with 63 errors on `develop` is the failing check.
