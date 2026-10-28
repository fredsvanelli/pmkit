# Changelog

## Unreleased

- `/pmkit:setup` sets up a Linear repository. It infers the workspace and the team, asks which status means in review and blocked and which label stands for each issue type, and writes them to `.pmkit/config.yaml` after one approval.
- Adds `mappings.types` to `.pmkit/config.yaml`: a pmkit issue type to the name of one Linear label, such as `bug: Bug`. `none` is a valid value for `mappings.status` and `mappings.fields`.
- Every Linear operation except `discover` and `capabilities` stops with `NOT_CONFIGURED` and `error.mappings` when a mapping names a team, status, field or label the workspace no longer has.
- Adds `resolveMappings(view, pmkit)` in `scripts/lib/linear/mappings.mjs`, the one reader of `mappings` for Linear issue operations.
- The Linear tracker supports issues, relations and search (PMK-35). A move to a category whose only state is Duplicate is refused until `mappings.status.<category>` names it.

## 0.2.0 - 2026-10-25

- Adds numbered IDs for issues and epics, such as `ISS-1` and `ISS-2`, as an option to the random IDs. `id_style` in `.issues/config.yaml` picks one, and `random` stays the default.
- `/pmkit:setup` asks which ID style to use. It recommends random IDs for the Local tracker and numbered IDs for a remote tracker.

Tracker format: 2
Setup: setup asks whether issue and epic IDs are random or numbered. A tracker set up before keeps random IDs until you change `id_style`.

## 0.1.0 - 2026-10-24

- Adds the Local tracker. Issues, epics, sprints and documents live as files in `.issues/` in your repository.
- Adds the GitHub git host. Branches, pull requests and merged pull requests work through `gh`.
- Adds the commands for issues, epics, sprints, documents and metrics.
- Adds `/pmkit:setup` to configure a project.
- Adds `/pmkit:upgrade` to update pmkit and move `.issues/` to a newer format.
