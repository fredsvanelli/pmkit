// E2E test of docs/runbooks/spec-import.md: the real CLI, run as a subprocess, on a Local tracker.
// The approval of /pmkit:spec:import cannot run in a test, so the test runs the CLI calls the command makes after it, in the
// order of its steps: the step 3 dry run that checks the spec path, the step 6 dry runs, the spec write of step 7.1, the epic
// with its description of step 7.2, the milestone of step 7.3, the issues of step 8 and the links of step 9.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { hashTree, makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'spec-import.md')
const SPEC_PATH = 'specs/bulk-export.md'
const CITED_PATH = '.issues/docs/specs/bulk-export.md'

const SPEC = `# Bulk export

## Goals

Finance copies invoices one by one to build the monthly report. An export of a full month saves that work.

## Scope

Export the invoices of one month as a CSV file. Scheduled exports are out of scope.

## Requirements

1. Queue the export. Criteria: an export request returns a job id.
2. Build the CSV. Criteria: the CSV has one row per invoice of the month.
`

const EPIC_DESCRIPTION = `### Purpose

Finance copies invoices one by one to build the monthly report. This epic gives finance analysts an export of a full month.

### Scope (in)

- Export the invoices of one month as a CSV file

### Out of scope

- Scheduled exports

### Documents

- Spec: ${CITED_PATH}
`

const ISSUES = [
  { title: 'Queue the export', type: 'feature', estimate: '3', criteria: '- An export request returns a job id\n' },
  { title: 'Build the CSV', type: 'feature', estimate: '5', criteria: '- The CSV has one row per invoice of the month\n' },
]

function pmkit(root, args) {
  const env = { ...childEnv(), ...userStoreEnv().env }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (result) => {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

/** Writes `text` to a new file outside the repository, as the command writes its temporary files, and returns the path. */
function tempFile(name, text) {
  const file = path.join(tempDir('pmkit-spec-import-tmp-'), name)
  fs.writeFileSync(file, text)
  return file
}

/** Runs the CLI calls of the command after the step 5 approval, in order, on a fresh `basic` repository. */
function runFlow() {
  const root = makeRepo('basic')
  const specFile = tempFile('spec.md', SPEC)
  const epicTitle = tempFile('epic-title.txt', 'Bulk export')
  const epicDescription = tempFile('epic-description.md', EPIC_DESCRIPTION)
  const milestoneName = tempFile('milestone-name.txt', 'First export')

  // Step 3: the dry run checks that the spec path is free and writes nothing.
  json(pmkit(root, ['docs', 'create', SPEC_PATH, '--body-file', specFile, '--dry-run', '--json']))

  // Step 6: the dry runs of the values, before any write. A new epic does not exist yet, so the issue dry run has no --parent.
  json(pmkit(root, ['epic', 'create', '--title-file', epicTitle, '--description-file', epicDescription, '--dry-run', '--json']))
  json(pmkit(root, ['milestone', 'create', 'v1', '--name-file', milestoneName, '--dry-run', '--json']))
  json(pmkit(root, ['issues', 'create', '--title-file', tempFile('dry-title.txt', ISSUES[0].title), '--type', ISSUES[0].type, '--estimate', ISSUES[0].estimate, '--dry-run', '--json']))

  // Step 7: the spec first, then the epic with its description, then the milestone.
  json(pmkit(root, ['docs', 'create', SPEC_PATH, '--body-file', specFile, '--json']))
  const epic = json(pmkit(root, ['epic', 'create', '--title-file', epicTitle, '--description-file', epicDescription, '--json'])).after.id
  json(pmkit(root, ['milestone', 'create', 'v1', '--name-file', milestoneName, '--json']))

  // Steps 8 and 9: the issues under the epic, then the blocker link.
  const ids = ISSUES.map((issue, index) => json(pmkit(root, [
    'issues', 'create', '--title-file', tempFile(`title-${index}.txt`, issue.title), '--type', issue.type, '--estimate', issue.estimate,
    '--milestone', 'v1', '--parent', epic, '--criteria-file', tempFile(`criteria-${index}.txt`, issue.criteria), '--json',
  ])).after.id)
  json(pmkit(root, ['issues', 'link', ids[0], ids[1], '--kind', 'blocks', '--json']))

  return { root, epic, ids, specFile }
}

test('the runbook names every call the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const call of [
    `docs create ${SPEC_PATH} --body-file tmp/spec.md --dry-run --json`,
    `docs create ${SPEC_PATH} --body-file tmp/spec.md --json`,
    'epic create --title-file tmp/epic-title.txt --description-file tmp/epic-description.md --dry-run --json',
    'epic create --title-file tmp/epic-title.txt --description-file tmp/epic-description.md --json',
    'milestone create v1 --name-file tmp/milestone-name.txt --dry-run --json',
    'milestone create v1 --name-file tmp/milestone-name.txt --json',
    'issues create --title-file tmp/title-1.txt --type feature --estimate 3 --dry-run --json',
    'issues create --title-file tmp/title-1.txt --type feature --estimate 3 --milestone v1 --parent <epic-id> --criteria-file tmp/criteria-1.txt --json',
    'issues create --title-file tmp/title-2.txt --type feature --estimate 5 --milestone v1 --parent <epic-id> --criteria-file tmp/criteria-2.txt --json',
    'issues link <id-1> <id-2> --kind blocks --json',
    `docs read ${SPEC_PATH} --json`,
    'epic get <epic-id> --json',
    CITED_PATH,
    '### Purpose',
  ]) {
    assert.ok(text.includes(call), call)
  }
})

test('import stores the spec, then creates the epic with a description that cites it', () => {
  const { root, epic, ids } = runFlow()

  const stored = json(pmkit(root, ['docs', 'read', SPEC_PATH, '--json']))
  assert.equal(stored.body, SPEC)

  const { description } = json(pmkit(root, ['epic', 'get', epic, '--json']))
  assert.ok(description.includes('### Purpose'), description)
  assert.ok(description.includes(CITED_PATH), description)
  assert.ok(fs.existsSync(path.join(root, CITED_PATH)), 'the cited path is a real file in the repository')

  const { issues } = json(pmkit(root, ['issues', 'list', '--parent', epic, '--json']))
  assert.deepEqual(issues.map((issue) => issue.id).sort(), [...ids].sort())
  for (const issue of issues) {
    assert.equal(typeof issue.estimate, 'number', `${issue.id} has an estimate`)
    assert.ok(issue.acceptanceCriteria.length > 0, `${issue.id} has acceptance criteria`)
    assert.equal(issue.milestone, 'v1')
  }
})

test('the step 3 dry run writes nothing', () => {
  const root = makeRepo('basic')
  const specFile = tempFile('spec.md', SPEC)
  const before = hashTree(path.join(root, '.issues'), ['.cache'])
  const dry = json(pmkit(root, ['docs', 'create', SPEC_PATH, '--body-file', specFile, '--dry-run', '--json']))
  assert.equal(dry.after.path, SPEC_PATH)
  assert.equal(dry.before, null)
  assert.equal(hashTree(path.join(root, '.issues'), ['.cache']), before, 'the dry run wrote nothing')
})

test('a second import with the same spec name answers CONFLICT at step 3', () => {
  const { root, specFile } = runFlow()
  const tracker = path.join(root, '.issues')
  const before = hashTree(tracker, ['.cache'])
  const result = pmkit(root, ['docs', 'create', SPEC_PATH, '--body-file', specFile, '--dry-run', '--json'])
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  assert.equal(JSON.parse(result.stdout).error.code, 'CONFLICT')
  assert.equal(hashTree(tracker, ['.cache']), before)
})
