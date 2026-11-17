# Runbook: spec from a PRD

The flow of `/pmkit:spec:from-prd` (`commands/spec/from-prd.md`) on a Local tracker: a one-page PRD becomes a refined PRD, an ADR, an epic with a milestone, three estimated issues with acceptance criteria, and a chain of blocker links. The interview and the approvals need a person, so `scripts/runbook-spec-from-prd.test.mjs` runs the CLI calls that the command makes after each approval, in the order of the stages, and `npm test` checks this runbook.

## Before you start

- `/pmkit:setup` ran on this repository with the Local tracker, so `.pmkit/config.yaml` and `.issues/config.yaml` exist.
- The PRD is a file or pasted text. This runbook uses a PRD titled `Bulk export`, so the slug is `bulk-export` and the refined PRD goes to `specs/bulk-export-prd.md`.
- Titles, names and bodies go through files, as `skills/pmkit/references/conventions.md` requires. The command writes them as temporary files outside `.issues/` with the file tool. The steps below use these:
  - `tmp/prd.md`: the refined PRD, with the sections Problem, Users, Scope (in), Out of scope, Use cases, Requirements, Decisions and Open questions. Its Decisions section marks `The export runs in the background` as `ADR` and `The CSV uses a comma as the separator` as `PRD only`.
  - `tmp/adr-title.txt`: `The export runs in the background`
  - `tmp/adr.md`: the ADR, whose context names `specs/bulk-export-prd.md`
  - `tmp/epic-title.txt`: `Bulk export`
  - `tmp/milestone-name.txt`: `First export`
  - `tmp/title-1.txt`, `tmp/title-2.txt`, `tmp/title-3.txt`: `Queue the export`, `Build the CSV` and `Download the CSV`
  - `tmp/description-1.txt` to `tmp/description-3.txt`: the description of each issue
  - `tmp/criteria-1.txt` to `tmp/criteria-3.txt`: the criteria of each requirement, copied from the refined PRD, one `- ` line each

## Stage 0: recon

1. The recon reads and writes nothing:

   ```
   node scripts/pmkit.mjs discover --json
   node scripts/pmkit.mjs epic list --json
   node scripts/pmkit.mjs milestone list --json
   node scripts/pmkit.mjs docs list --json
   node scripts/pmkit.mjs issues list --text 'export' --json
   ```

   In a new repository every list is empty, so the command says in one line that it found no duplicate and goes on.

## Stages 1 and 2: interview and refined PRD

2. The interview writes nothing. After it, the command drafts the refined PRD in `tmp/prd.md` and checks that its path is free:

   ```
   node scripts/pmkit.mjs docs create specs/bulk-export-prd.md --body-file tmp/prd.md --dry-run --json
   ```

   Expect exit code 0, `before: null` and the draft in `after`. The dry run writes nothing under `.issues/`. When the path is taken, the dry run exits with code 2 and `CONFLICT`, and the command asks for another name. The PM approves the content and the path. The command does not write the file yet.

## Stage 3: ADRs

3. For each decision marked `ADR`, the command follows `commands/spec/record-decision.md`. It reads the number of the next ADR:

   ```
   node scripts/pmkit.mjs docs next-adr --title-file tmp/adr-title.txt --json
   ```

   In a repository without a `docs/adr/` folder, expect `number: "0001"`, `destination: "tracker"` and `docPath: "adr/0001-the-export-runs-in-the-background.md"`. After the PM approves the ADR, the command writes it at `docPath`:

   ```
   node scripts/pmkit.mjs docs create adr/0001-the-export-runs-in-the-background.md --body-file tmp/adr.md --json
   ```

   With `destination: "repo"`, the command writes the file at `path` under `docs/adr/` with the file tool instead. Either way the ADR names `specs/bulk-export-prd.md`, so a resume can find it.

## Stage 3b: store the refined PRD

4. The command writes the refined PRD after the ADRs, with the final mark of each decision:

   ```
   node scripts/pmkit.mjs docs create specs/bulk-export-prd.md --body-file tmp/prd.md --json
   ```

   Expect `after.path: "specs/bulk-export-prd.md"`. `docs read specs/bulk-export-prd.md --json` returns the body. A second write to the same path exits with code 2 and `CONFLICT` and changes nothing under `.issues/docs/`.

## Stage 4: epic and milestones

5. After the PM approves the epic and its milestone, the command follows steps 6 and 7 of `commands/spec/import.md`. It runs the dry runs of step 6 before these writes. Then it writes:

   ```
   node scripts/pmkit.mjs epic create --title-file tmp/epic-title.txt --json
   node scripts/pmkit.mjs milestone create v1 --name-file tmp/milestone-name.txt --json
   ```

   Expect the new epic ID in `after.id`, such as `EPC-M0GZ`, and the milestone `v1`.

## Stage 5: issue tree

6. After the PM approves the tree, the command follows steps 6, 8 and 9 of `commands/spec/import.md`. It runs the dry runs of step 6 for the top-level issues before these writes. Then it creates each issue under the epic, with its estimate, description and criteria:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --estimate 3 --milestone v1 --parent <epic-id> --description-file tmp/description-1.txt --criteria-file tmp/criteria-1.txt --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-2.txt --type feature --estimate 5 --milestone v1 --parent <epic-id> --description-file tmp/description-2.txt --criteria-file tmp/criteria-2.txt --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-3.txt --type task --estimate 2 --milestone v1 --parent <epic-id> --description-file tmp/description-3.txt --criteria-file tmp/criteria-3.txt --json
   ```

   Then it links the blockers of the tree: issue 1 blocks issue 2, and issue 2 blocks issue 3.

   ```
   node scripts/pmkit.mjs issues link <id-1> <id-2> --kind blocks --json
   node scripts/pmkit.mjs issues link <id-2> <id-3> --kind blocks --json
   ```

## Stage 6: final check

7. The check reads each new issue, then the blocker chain of the epic:

   ```
   node scripts/pmkit.mjs issues get <id-1> --json
   node scripts/pmkit.mjs issues get <id-2> --json
   node scripts/pmkit.mjs issues get <id-3> --json
   node scripts/pmkit.mjs issues dependencies <epic-id> --json
   ```

   The E2E test reads the issues with `issues list --parent <epic-id> --json`, one call that stands in for the three `issues get` calls. Expect the three issues, each with an `estimate`, a non-empty `acceptanceCriteria` and `milestone: "v1"`. `issues dependencies` returns `basis: "blockers"`, `problems: []` and `criticalPath.ids` with the three IDs in the order of the chain. The output of the command shows that critical path and ends with `/pmkit:cycle:plan`.

## Resume

8. `/pmkit:spec:from-prd specs/bulk-export-prd.md` resumes from the stored refined PRD. It finds the ADRs that cite the PRD path:

   ```
   node scripts/pmkit.mjs docs list --json
   node scripts/pmkit.mjs docs read adr/0001-the-export-runs-in-the-background.md --json
   ```

   Expect `adr/0001-the-export-runs-in-the-background.md` in the list, and a `body` that contains `specs/bulk-export-prd.md`. The resume then skips the decision that already has this ADR. A repository ADR under `docs/adr/` is read with the file tools instead.

## What the test checks

The test runs every call above on a copy of the `basic` fixture, with the real CLI as a subprocess. It checks that the Stage 2 dry run writes nothing, that the stored refined PRD reads back with the same body, that every issue of the epic has an estimate and criteria, and that the critical path follows the blocker links. It checks that a taken PRD path answers `CONFLICT` to the dry run and to the write, and leaves `.issues/docs/` unchanged. It checks that a resume finds the ADR through `docs list` and `docs read`.
