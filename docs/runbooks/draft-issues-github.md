# Runbook: draft issues on GitHub Issues

The flow of `/pmkit:github:draft-issues` on a repository whose tracker is GitHub Issues: list the draft issues of the Project, preview the conversion, convert the chosen drafts, and set the pmkit fields of the new issues. Then an archived draft, another target repository and a setup with no Project. `scripts/runbook-draft-issues-github.test.mjs` runs every step below with the real CLI and a fake `gh` first on `PATH`. The fake keeps the state of GitHub in a file between runs, so `npm test` checks this runbook.

## Before you start

- `/pmkit:setup` ran on this repository, as `docs/runbooks/setup-github.md` describes, with the Project `acme/7`.
- `gh` is logged in to the host of the repository, with the `project` scope.
- The Project `acme/7` holds four draft items, in this board order:
  - `PVTI_1`, `Add an offline mode`, with a Context and an acceptance criterion in its body, assigned to `hubot`, Status `Todo`.
  - `PVTI_2`, `Old idea`, archived.
  - `PVTI_3`, `Dark theme`, with a one-line body.
  - `PVTI_4`, `Docs: a getting started page`, with no body.
- The repository `acme/docs` exists on the same host and has issues turned on.

## Review and convert

1. List the drafts:

   ```
   node scripts/pmkit.mjs github draft-issues list --json
   ```

   Expect `available: true`, the Project `Roadmap`, and three drafts: `PVTI_1`, `PVTI_3` and `PVTI_4`. The archived `PVTI_2` is left out. `PVTI_1` has `assignees: ["hubot"]` and `fields: { "Status": "Todo" }`. The command shows them as a table with a maturity note: `PVTI_1` reads as ready, `PVTI_4` lacks a description.

2. Preview the conversion of the two ready drafts:

   ```
   node scripts/pmkit.mjs github draft-issues convert PVTI_1 PVTI_3 --dry-run --json
   ```

   Expect `dryRun: true`, `target: { "repo": "acme/widgets", "tracked": true }`, both drafts with their whole body, and no warning. Nothing changes on GitHub.

3. Convert them:

   ```
   node scripts/pmkit.mjs github draft-issues convert PVTI_1 PVTI_3 --json
   ```

   Expect `converted` with issue `1` from `PVTI_1` and issue `2` from `PVTI_3`, each with its link. GitHub ran `convertProjectV2DraftIssueItemToIssue` twice. The Project items stay, now with the issues as their content.

4. Read issue 1:

   ```
   node scripts/pmkit.mjs issues get 1 --json
   ```

   Expect the title `Add an offline mode`, the status category `todo` (the item kept its Status), and the assignee `hubot`. It has no type yet: the conversion sets none.

5. Set the pmkit fields of issue 1, first as a preview, then for real:

   ```
   node scripts/pmkit.mjs issues update 1 --type feature --priority high --label bug --dry-run --json
   node scripts/pmkit.mjs issues update 1 --type feature --priority high --label bug --json
   ```

   Expect `after.type: "feature"`, `after.priority: "high"` and `after.labels: ["bug"]` in both. The preview writes nothing. With more than one new issue, the command shows every preview together and asks once.

## Refusals

6. Try to convert the archived draft:

   ```
   node scripts/pmkit.mjs github draft-issues convert PVTI_2 --dry-run --json
   ```

   Expect exit code 2 and `INVALID_INPUT`, `item PVTI_2 is archived`, with the next step `pmkit github draft-issues list`. In a batch, one wrong item converts nothing.

7. Preview a conversion into another repository:

   ```
   node scripts/pmkit.mjs github draft-issues convert PVTI_4 --repo acme/docs --dry-run --json
   ```

   Expect `target: { "repo": "acme/docs", "tracked": false }` and the warning `acme/docs is not tracker.scope.repo (acme/widgets), so pmkit will not track the new issues`. The command skips the field step for such issues.

8. Set `tracker.scope.project: none` in `.pmkit/config.yaml` and list again:

   ```
   node scripts/pmkit.mjs github draft-issues list --json
   ```

   Expect `available: false`, `reason: "no_project"` and the `enableHint` `Pass --project owner/number, or set tracker.scope.project with /pmkit:setup`.

Every `gh` call of these steps runs `gh api --hostname github.com`, and none holds a token.
