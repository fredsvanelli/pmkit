# PMK-254: verify Linear issue docs against a live workspace

## Problem

PMK-252 stores a Linear issue's docs as attachments (`metadata.pmkitDoc`), tested against the fake only. `scripts/lib/linear/API-VERIFICATION.md` ("Issue docs mapped (PMK-252)") lists the live checks still owed. The sandbox write guard has no `attachmentCreate` or `attachmentDelete`, so a live run cannot send them.

## Approaches

1. **Guard rules for the two attachment mutations on the run's own issues, a live docs probe, and the result written into the PMK-252 section** (chosen). Same shape as PMK-255 and PMK-356.
2. A one-off script outside the live run. It would bypass the guard that pins every write to the test team.

## Design

- `scripts/lib/linear/sandbox.mjs`: `SUITE_INPUT_KEYS.attachmentCreate = ['issueId', 'url', 'title', 'metadata']`; the rule takes an issue the run owns, a `url` that starts with `https://`, and a `metadata` that is absent or holds only a string `pmkitDoc`. `CREATES.attachmentCreate = ['attachment', 'attachment']`, so the new attachment is the run's own. `attachmentDelete` takes only an attachment the run owns. The allowlist grows from 17 to 19.
- `scripts/lib/linear/live-probes.mjs` `docsProbe({ tracker, client, actor, config })`: sets `git_host` to a GitHub repo for the probe and restores it after; creates an issue; adds `docs/pmkit-probe-a.md` and reads it back; adds it again (no change); creates a hand-made attachment with the link of `docs/pmkit-probe-b.md` through `ATTACHMENT_CREATE` and no metadata, then asks pmkit to add that doc and expects `CONFLICT`; removes doc a; reads the raw attachments and asserts the hand-made one is still there, unchanged. It records the raw attachment fields Linear returns (`metadata`, and `sourceType` when present). `contract-live.mjs` passes `config: run.config` to every probe.
- `API-VERIFICATION.md`: each point of the PMK-252 section marked confirmed or corrected, with the date and "live probe `docs`, 2026-11-22".
- Any difference from the fake is fixed in the adapter and the fake, with a test; none is expected.

`/pmkit:spec:record-decision` step 6 runs `issues comment` and `issues update --add-doc`; the probe sends the same adapter calls, so its run covers that step on Linear.

## Interview

- The repo in the probe's links: a fixed placeholder (`pmkit-probe/pmkit`); the links are never opened, and the issues are trashed after.
- New terms or ADRs: none.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
