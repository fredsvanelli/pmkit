# PMK-247: ADR folders when the tracker is the repository or outside it

## Intent
`docs next-adr`, `docs adr-status` and `validate` share `adrFolders` (`scripts/lib/adr.mjs`). It treats two tracker locations unlike any other:
- `tracker.path: .` puts the tracker's `docs/adr` on the repository's own folder, which is read once and labelled `repo`. `docs adr-status` then writes the file as a repository file and never commits it, and `docs next-adr` points at a repository file, whatever `auto_commit` says.
- A tracker outside the repository labels its folder `docs/adr`, like the repository's. With `0002-a.md` in both, `validate` and the `CONFLICT` error show two identical paths.

## Goals
- With `tracker.path: .` the shared folder has `place: tracker`, so `docs adr-status` writes through the tracker (`updateDocument`, committed when `auto_commit` is on) and `docs next-adr` answers `destination: tracker` with a `docPath` for `docs create`, as for any other tracker path (AC1).
- The ADR folder of a tracker outside the repository is labelled `tracker:docs/adr`, so its paths read `tracker:docs/adr/0002-a.md` in `validate`, in the `CONFLICT` error, in `next-adr` and in `adr-status` (AC2).

## Non-goals
- Other `tracker.path` values. A hosted tracker keeps the repository folder only.
- Reading `origin` for a folder outside the repository (unchanged).

## Design
- `adrFolders`: when the tracker folder is the repository folder, the single entry gets `place: 'tracker'` (label `docs/adr`, `repoFolder` `docs/adr`, so `origin` is still read once). When it lies outside the repository, `label` is `tracker:docs/adr` (`shown` stays `docs/adr in the tracker`).
- `planNextAdr`: `repoExists` only counts a `repo` folder, so the merged folder gives `destination: tracker` when the tracker can create documents; the path stays `docs/adr/...`.
- `adr-status` already routes by `place`: no change in `pmkit.mjs`.
- The two command files (`record-decision.md`, `adr-status.md`) say the path of an outside tracker is `tracker:docs/adr/...`.

## Decisions I made
- Prefix `tracker:` rather than the absolute folder, which would put a path of this machine in the JSON (PMK-194 refused that).
- With `tracker.path: .` and an existing `docs/adr`, `next-adr` now answers `tracker` where it said `repo`: that is what "the same as any other tracker path" asks for. A tracker with `.issues/` and a `docs/adr` in the repository still answers `repo`.
