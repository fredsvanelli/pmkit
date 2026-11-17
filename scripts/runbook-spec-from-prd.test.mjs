// E2E test of docs/runbooks/spec-from-prd.md: the real CLI, run as a subprocess, on a Local tracker.
// The interview and the approvals of /pmkit:spec:from-prd cannot run in a test, so the test runs the CLI calls the command
// makes after each approval, in the order of the stages: the refined PRD (dry run, then the write), the ADR, the epic with
// its milestone, the issues with estimates and criteria, and the blocker links. Then it checks the result and the resume.
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
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'spec-from-prd.md')
const PRD_PATH = 'specs/bulk-export-prd.md'

const PRD = `# Bulk export

## Problem

Finance copies invoices one by one to build the monthly report.

## Users

Finance analysts.

## Scope (in)

Export the invoices of one month as a CSV file.

## Out of scope

Scheduled exports.

## Use cases

An analyst picks a month and downloads the CSV.

## Requirements

1. Queue the export. Criteria: an export request returns a job id.
2. Build the CSV. Criteria: the CSV has one row per invoice of the month.
3. Download the CSV. Criteria: the analyst downloads the file from the job page.

## Decisions

- The export runs in the background, never in the request: ADR.
- The CSV uses a comma as the separator: PRD only.

## Open questions

None.
`

const ISSUES = [
  { title: 'Queue the export', type: 'feature', estimate: '3', criteria: '- An export request returns a job id\n' },
  { title: 'Build the CSV', type: 'feature', estimate: '5', criteria: '- The CSV has one row per invoice of the month\n' },
  { title: 'Download the CSV', type: 'task', estimate: '2', criteria: '- The analyst downloads the file from the job page\n' },
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
  const file = path.join(tempDir('pmkit-from-prd-tmp-'), name)
  fs.writeFileSync(file, text)
  return file
}

/** Runs the CLI calls of every stage after its approval, in order, on a fresh `basic` repository. */
function runFlow() {
  const root = makeRepo('basic')
  const prdFile = tempFile('prd.md', PRD)

  // Stage 0: the recon reads. A new repository has no duplicate.
  json(pmkit(root, ['discover', '--json']))
  for (const list of [['epic', 'list'], ['milestone', 'list'], ['docs', 'list']]) assert.deepEqual(json(pmkit(root, [...list, '--json'])), [], list.join(' '))
  assert.deepEqual(json(pmkit(root, ['issues', 'list', '--text', 'export', '--json'])).issues, [])

  // Stage 2: the dry run checks that the path is free and writes nothing.
  const before = hashTree(path.join(root, '.issues'), ['.cache'])
  const dry = json(pmkit(root, ['docs', 'create', PRD_PATH, '--body-file', prdFile, '--dry-run', '--json']))
  assert.equal(dry.after.path, PRD_PATH)
  assert.equal(hashTree(path.join(root, '.issues'), ['.cache']), before, 'the dry run wrote nothing')

  // Stage 3: the ADR, through record-decision: the next number, then the write at its path. Its context names the PRD path.
  const next = json(pmkit(root, ['docs', 'next-adr', '--title-file', tempFile('adr-title.txt', 'The export runs in the background'), '--json']))
  const adrBody = `# ${next.number}. The export runs in the background\n\n## Status\n\nAccepted\n\n## Context\n\nThe refined PRD ${PRD_PATH} needs exports of a full month.\n\n## Decision\n\nThe export runs in the background, never in the request.\n`
  if (next.destination === 'repo') {
    fs.mkdirSync(path.dirname(path.join(root, next.path)), { recursive: true })
    fs.writeFileSync(path.join(root, next.path), adrBody)
  } else {
    json(pmkit(root, ['docs', 'create', next.docPath, '--body-file', tempFile('adr.md', adrBody), '--json']))
  }

  // Stage 3b: the refined PRD, after the ADRs.
  json(pmkit(root, ['docs', 'create', PRD_PATH, '--body-file', prdFile, '--json']))

  // Stage 4: the epic and its milestone.
  const epic = json(pmkit(root, ['epic', 'create', '--title-file', tempFile('epic-title.txt', 'Bulk export'), '--json'])).after.id
  json(pmkit(root, ['milestone', 'create', 'v1', '--name-file', tempFile('milestone-name.txt', 'First export'), '--json']))

  // Stage 5: the issues with estimates and criteria, then the blocker links of the tree.
  const ids = ISSUES.map((issue, index) => json(pmkit(root, [
    'issues', 'create', '--title-file', tempFile(`title-${index}.txt`, issue.title), '--type', issue.type, '--estimate', issue.estimate,
    '--milestone', 'v1', '--parent', epic,
    '--description-file', tempFile(`description-${index}.txt`, `Requirement ${index + 1} of ${PRD_PATH}.\n`),
    '--criteria-file', tempFile(`criteria-${index}.txt`, issue.criteria), '--json',
  ])).after.id)
  json(pmkit(root, ['issues', 'link', ids[0], ids[1], '--kind', 'blocks', '--json']))
  json(pmkit(root, ['issues', 'link', ids[1], ids[2], '--kind', 'blocks', '--json']))

  return { root, epic, ids, next, prdFile }
}

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of [
    'docs create specs/', 'docs next-adr --title-file', 'epic create --title-file', 'milestone create', 'issues create --title-file',
    '--criteria-file', 'issues link', '--kind blocks', 'issues dependencies',
  ]) {
    assert.ok(text.includes(command), command)
  }
})

test('runbook: a refined PRD becomes an ADR, an epic, estimated issues with criteria, and a critical path', () => {
  const { root, epic, ids } = runFlow()

  const stored = json(pmkit(root, ['docs', 'read', PRD_PATH, '--json']))
  assert.equal(stored.body, PRD)

  const { issues } = json(pmkit(root, ['issues', 'list', '--parent', epic, '--json']))
  assert.deepEqual(issues.map((issue) => issue.id).sort(), [...ids].sort())
  for (const issue of issues) {
    assert.equal(typeof issue.estimate, 'number', `${issue.id} has an estimate`)
    assert.ok(issue.acceptanceCriteria.length > 0, `${issue.id} has acceptance criteria`)
    assert.equal(issue.milestone, 'v1')
  }

  // Stage 6: the final check reads the blocker chain of the epic.
  const dependencies = json(pmkit(root, ['issues', 'dependencies', epic, '--json']))
  assert.equal(dependencies.basis, 'blockers')
  assert.deepEqual(dependencies.criticalPath.ids, ids)
  assert.deepEqual(dependencies.problems, [])
})

test('runbook: a taken PRD path answers CONFLICT and writes nothing', () => {
  const { root, prdFile } = runFlow()
  const docs = path.join(root, '.issues', 'docs')
  const before = hashTree(docs)
  for (const extra of [['--dry-run'], []]) {
    const result = pmkit(root, ['docs', 'create', PRD_PATH, '--body-file', prdFile, ...extra, '--json'])
    assert.equal(result.code, 2, `${extra.join(' ')}: ${result.stdout}`)
    assert.equal(JSON.parse(result.stdout).error.code, 'CONFLICT')
  }
  assert.equal(hashTree(docs), before)
})

test('runbook: a resume finds the ADR that cites the refined PRD', () => {
  const { root, next } = runFlow()
  let adr
  if (next.destination === 'repo') {
    adr = fs.readFileSync(path.join(root, next.path), 'utf8')
  } else {
    const docs = json(pmkit(root, ['docs', 'list', '--json']))
    assert.ok(docs.some((doc) => doc.path === next.docPath), docs.map((doc) => doc.path).join(', '))
    adr = json(pmkit(root, ['docs', 'read', next.docPath, '--json'])).body
  }
  assert.ok(adr.includes(PRD_PATH), 'the ADR cites the refined PRD path')
})
