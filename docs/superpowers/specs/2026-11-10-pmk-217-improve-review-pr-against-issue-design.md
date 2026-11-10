# PMK-217: improve review-pr-against-issue

Follow-up of PMK-61 (`/pmkit:issues:review`), from EPC-6. The command reviews the pull request of an issue against its
acceptance criteria and posts the result as a comment on the issue. Three gaps were found while it was used:

1. The result only reaches the issue. The person who reads the pull request never sees it, and the findings cannot point at a line.
2. A cut diff (over 2000 lines) can only be read whole again with `--max-lines <lines>`, which is the same wall of text that was cut.
3. The review judges the diff alone. A failing check on the pull request says the work is not done, and the review ignores it.

Worker mode: the coordinator asked for no questions, so every decision below is the implementer's call.

## Goals

- Criterion 1: post the review on the pull request itself, as one GitHub review with inline comments on the lines of the diff.
- Criterion 2: read a cut diff file by file.
- Criterion 3: read `pr status` and `ci logs` into the review, so a failing check is a gap.

## Non-goals

- The defects found in the PMK-61 reviews (their own bug issues).
- Approving or requesting changes. The review only comments.
- Redacting the pull request review. The review never holds CI log lines, only the run link and the step name, as `/pmkit:issues:investigate-bug` does.

## Design

### `pr review --issue <id> --body-file f [--comments-file f]` (new CLI write)

- Finds the open pull request of the issue branch, like `pr ready`. No branch, or no open pull request: `INVALID_INPUT` with a next step.
- `--body-file` holds the summary of the review (required, not empty). `--comments-file` holds a JSON array of
  `{ "path", "line", "body" }`: `path` is the file in the diff, `line` the line number in the new version of the file, `body` the finding.
- Before any write (dry run and real run), each inline comment is checked against the pull request diff: the line must be an added
  or context line of a hunk of that file. A comment that fails is refused with `INVALID_INPUT` that names every bad entry, and nothing
  is posted. When GitHub refuses the diff as too large, the lines cannot be checked, so a review with inline comments is refused
  (`INVALID_INPUT`, next step: put the findings in the body); one with only a body goes on.
- One call posts the review: `gh api repos/{owner}/{repo}/pulls/<n>/reviews --method POST --input -` with
  `{ event: "COMMENT", body, comments: [{ path, line, side: "RIGHT", body }] }`. GitHub posts the whole review or nothing, so a
  failure leaves nothing half written; the command file says so.
- Dry run returns `{ pr, event, body, comments }` and writes nothing. The real run adds `review: { id, url }`.
- It joins `linked_code` in `SERVED_BY`. It needs only the git host, so the tracker path does not change and the ADR-0001 counts stay.

### `pr diff --file <path>` and `files` (CLI read)

- `files` in the JSON lists every file of the full diff, in order: `{ path, lines, cut }`, `cut` true when some of its lines fall
  after the kept part.
- `--file <path>` keeps only the sections of that file; `--max-lines`, `truncated` and `lines` then apply to that file. A path that
  is not in the diff is `INVALID_INPUT`.
- The path of a section comes from `+++ b/<path>`, or `--- a/<path>` for a deleted file, or `rename to <path>`, or the
  `diff --git a/<p> b/<p>` header for a binary file. A quoted path (special characters) stays as git quotes it.

### `commands/issues/review.md`

- Step 3.2: when `truncated`, read each file whose `cut` is `true`, one at a time, with `pr diff --branch <branch> --file '<path>' --json`
  (the path is data: single quotes, `'` written as `'\''`). A file that is itself cut is read with `--max-lines <its lines>`, or the
  criteria that depend on it are `not checked`.
- New step: read the checks. Run `pr status --branch <branch> --json` when the diff came from the pull request. A check with
  `bucket` `fail` is a gap of the review; read its log with `ci logs --run <runId> --json` to name the failing step, and a criterion
  whose test fails in it cannot be `covered` (at most `partly`, naming the check). `pending` and `cancel` checks are `not checked`.
  When the call fails, or there is no pull request, the checks are `not checked`, never passing.
- The result shows a "Checks" part, and the counts include the failing checks.
- Posting: offer the issue comment (as today) and, when the diff came from an open pull request, the pull request review with
  `pr review`: the summary as the body, each finding that points at a diff line as an inline comment. Each write asks once.

## Testing

- `scripts/cli-pr.test.mjs`: `pr diff` `files`/`cut`, `--file` (found, missing, cut), path parsing (rename, delete, binary);
  `pr review` dry run, real run (input JSON to gh), refused lines, too-large diff, no open pull request, bad comments file.
- Scenario `issues-review`: reads `pr status`, posts the issue comment and the pull request review; a second entry with a cut diff
  read file by file and a failing check that shows as a gap.
- Goldens, degraded coverage and the read/write lists pick up the new command.
