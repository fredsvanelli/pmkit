# Changelog

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
