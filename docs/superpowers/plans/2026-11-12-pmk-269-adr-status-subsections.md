# PMK-269 plan

Spec: `docs/superpowers/specs/2026-11-12-pmk-269-adr-status-subsections-design.md`. Test first, then the code, commit with `(PMK-269)`.

1. **Tests** (criteria 1 and 2) in `scripts/adr.test.mjs`: `adrInfo` shows only `Accepted` with a `### Notes` subsection; `setAdrStatus` rewrites the status and keeps the subsection byte for byte; an unchanged status leaves the text as it came; a `###` line inside a fenced block stays part of the section. Run them and see them fail.
2. **Code**: in `locate().end` in `scripts/lib/adr.mjs`, change `/^#{1,2} /` to `/^#{1,6} /`; update the comments.
3. **Docs**: one CHANGELOG line under `## Unreleased`; README, `skills/pmkit/SKILL.md` and `commands/spec/adr-status.md` checked for text about the section end.
4. **Finish**: `npm test` in the foreground, tick the two criteria, commit `.issues/`.
