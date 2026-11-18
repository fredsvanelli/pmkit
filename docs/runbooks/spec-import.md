# Runbook: import a spec

The flow of `/pmkit:spec:import` (`commands/spec/import.md`) on a Local tracker: a pasted spec becomes a stored document, an epic whose description cites it, a milestone, two estimated issues with acceptance criteria and a blocker link. The last section runs the same flow on GitHub Issues, where the spec goes to a repository file. The tree and the approval need a person, so `scripts/runbook-spec-import.test.mjs` runs the step 3 dry run that checks the spec path, and then the CLI calls that the command makes after the approval of step 5, in the order of its steps. `npm test` checks this runbook.

## Before you start

- `/pmkit:setup` ran on this repository with the Local tracker, so `.pmkit/config.yaml` and `.issues/config.yaml` exist.
- The spec is pasted text, so it is outside the tracker's `docs/` folder. This runbook uses a spec titled `Bulk export`, so the name is `bulk-export` and the spec goes to `specs/bulk-export.md`.
- Titles, names and bodies go through files, as `skills/pmkit/references/conventions.md` requires. The command writes them as temporary files outside `.issues/` with the file tool. The steps below use these:
  - `tmp/spec.md`: the pasted spec, with the sections Goals, Scope and Requirements
  - `tmp/epic-title.txt`: `Bulk export`
  - `tmp/epic-description.md`: the description of the new epic, in the template of step 3 of the command
  - `tmp/milestone-name.txt`: `First export`
  - `tmp/title-1.txt` and `tmp/title-2.txt`: `Queue the export` and `Build the CSV`
  - `tmp/criteria-1.txt` and `tmp/criteria-2.txt`: the criteria of each requirement, copied from the spec, one `- ` line each

## Step 3: choose the spec path

1. The command drafts the epic description and picks where the spec would be stored. It checks that the path is free:

   ```
   node scripts/pmkit.mjs docs create specs/bulk-export.md --body-file tmp/spec.md --dry-run --json
   ```

   Expect exit code 0, `before: null` and the spec in `after`. The dry run writes nothing under `.issues/`. When the path is taken, the dry run exits with code 2 and `CONFLICT`, and the command asks for another name. On a tracker that cannot create documents, the dry run answers `NOT_SUPPORTED`, and the command uses the repository file `docs/specs/<name>.md` instead.

2. The description cites the spec where it will really be. On the Local tracker a stored document lives under `.issues/docs/`, so the Documents section of the description is:

   ```markdown
   ### Documents

   - Spec: .issues/docs/specs/bulk-export.md
   ```

   The whole description has the sections `### Purpose`, `### Scope (in)`, `### Out of scope` and `### Documents`. The command shows it with the tree in step 4 and asks for the approval in step 5.

## Step 6: dry runs

3. After the approval, the command checks every value before any write. The new epic and the new milestone have no files yet, so the issue dry run leaves out `--parent` and `--milestone`:

   ```
   node scripts/pmkit.mjs epic create --title-file tmp/epic-title.txt --description-file tmp/epic-description.md --dry-run --json
   node scripts/pmkit.mjs milestone create v1 --name-file tmp/milestone-name.txt --dry-run --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --estimate 3 --dry-run --json
   ```

   Each call exits with code 0 and writes nothing. The command checks only the top-level issues here. A sub-issue is checked when step 8 creates it.

## Step 7: store the spec, then create the epic and the milestone

4. The command stores the spec first, so the epic never cites a file that does not exist:

   ```
   node scripts/pmkit.mjs docs create specs/bulk-export.md --body-file tmp/spec.md --json
   ```

   Expect `after.path: "specs/bulk-export.md"`. `docs read specs/bulk-export.md --json` returns the body of the spec. The tracker commits the document when `auto_commit` is on. When this call fails, the command stops with nothing else created.

5. The command creates the epic with its description, then the milestone:

   ```
   node scripts/pmkit.mjs epic create --title-file tmp/epic-title.txt --description-file tmp/epic-description.md --json
   node scripts/pmkit.mjs milestone create v1 --name-file tmp/milestone-name.txt --json
   ```

   Expect the new epic ID in `after.id`, such as `EPC-M0GZ`, and the milestone `v1`. Then `epic get <epic-id> --json` returns a `description` that contains `### Purpose` and the path `.issues/docs/specs/bulk-export.md`. That path is a real file in the repository, so a reader on GitHub or Linear can follow it.

## Steps 8 and 9: issues and links

6. The command creates each issue under the epic, with its estimate and criteria, then links the blocker of the tree: issue 1 blocks issue 2.

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --estimate 3 --milestone v1 --parent <epic-id> --criteria-file tmp/criteria-1.txt --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-2.txt --type feature --estimate 5 --milestone v1 --parent <epic-id> --criteria-file tmp/criteria-2.txt --json
   node scripts/pmkit.mjs issues link <id-1> <id-2> --kind blocks --json
   ```

   `issues list --parent <epic-id> --json` returns the two issues, each with an `estimate`, a non-empty `acceptanceCriteria` and `milestone: "v1"`.

## A second import of the same spec

7. When the user imports the same spec again under the same name, the step 3 dry run answers `CONFLICT`:

   ```
   node scripts/pmkit.mjs docs create specs/bulk-export.md --body-file tmp/spec.md --dry-run --json
   ```

   Expect exit code 2 and `error.code: "CONFLICT"`. Nothing under `.issues/` changes. The command asks for another name and never overwrites the stored spec.

## On GitHub Issues: the spec goes to a repository file

8. On a repository set up with `/pmkit:setup` for GitHub Issues, the tracker cannot create documents. The step 3 dry run answers `NOT_SUPPORTED`:

   ```
   node scripts/pmkit.mjs docs create specs/bulk-export.md --body-file tmp/spec.md --dry-run --json
   ```

   Expect exit code 2 and `error.code: "NOT_SUPPORTED"`. The command then picks the repository file `docs/specs/bulk-export.md` and checks with the file tools that it does not exist yet. The Documents section of the description cites that path:

   ```markdown
   ### Documents

   - Spec: docs/specs/bulk-export.md
   ```

9. After the approval, the command runs the step 6 dry runs of the epic and the top-level issue, the same calls as in the Local flow. In step 7.1 it checks again that `docs/specs/bulk-export.md` is absent and writes the spec there with the file tools. Then it creates the epic and the issues under it. GitHub has no milestone in this tree, so the issue has no `--milestone`:

   ```
   node scripts/pmkit.mjs epic create --title-file tmp/epic-title.txt --description-file tmp/epic-description.md --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --estimate 3 --parent <epic-id> --criteria-file tmp/criteria-1.txt --json
   ```

   Expect the Project of the new epic in `after.id`, such as `acme/13`. `epic get <epic-id> --json` returns a `description` that contains `### Purpose` and the path `docs/specs/bulk-export.md`, the repository file that holds the spec. Nothing is written under `.issues/docs/`. The file has no commit until the user commits it.

## What the test checks

The test runs every call above on a copy of the `basic` fixture, with the real CLI as a subprocess. It checks that the step 3 dry run writes nothing, that the stored spec reads back with the same body, and that the epic description contains `### Purpose` and the path `.issues/docs/specs/bulk-export.md`, which exists in the repository. It checks that every issue of the epic has an estimate, criteria and the milestone. It checks that a second dry run with the same spec name answers `CONFLICT` and changes nothing.

The GitHub case runs on a repository set up for GitHub Issues, with a fake `gh` first on `PATH` (`scripts/fake-gh-path.mjs` over the stateful fake GitHub of `scripts/fake-github-issues.mjs`). It checks that the step 3 dry run answers `NOT_SUPPORTED`, that the spec is in `docs/specs/bulk-export.md` and nowhere under `.issues/docs/`, that the epic description cites `docs/specs/bulk-export.md`, and that the issue sits under the epic.
