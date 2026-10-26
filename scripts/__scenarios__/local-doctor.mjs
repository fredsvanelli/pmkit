// /pmkit:local:doctor on the messy-merge fixture. Validate finds two conflicted files (ISS-4, ISS-5) and a second
// active sprint. The fixture has no `value` or `reference` problem, so setup adds one of each by hand: priority
// `critical` on ISS-7 and a parent EPC-9, which does not exist, on ISS-8. Those hand edits also show as `drift`.
// Step 2: ISS-4 has two creates of the same ID from two branches. The user declines its resolution, so there is no
// confirm and no edit, and the file keeps its markers. ISS-5 has fred's move to in_progress and ana's move to
// in_review at the same time; the log ends with in_review, so the resolution keeps in_review.
// Neither file parses, so `issues get --history` fails with CONFLICT for both.
// Step 4 fixes the priority and the parent; steps 3 and the other step 4 fixes have nothing to do.
// Step 6 rebuilds the query index, which git ignores, so the snapshot shows no file for it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const resolved = `---
id: ISS-5
title: Export invoices as CSV
type: feature
status: in_review
priority: medium
estimate: 5
assignee: fred
labels: [billing]
sprint: 2026-10-12
created: 2026-10-12T10:00:00Z
updated: 2026-10-16T09:00:00Z
---

## Description

Finance needs a monthly CSV of invoices.
`
const priority = ['issues', 'update', 'ISS-7', '--priority', 'high']
const parent = ['issues', 'parent', 'ISS-8', 'none']

function editFrontmatter(root, id, from, to) {
  const file = path.join(root, '.issues', 'issues', id, 'issue.md')
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes(from)) throw new Error(`${id} has no line ${from}`)
  fs.writeFileSync(file, text.replace(from, to))
}

export default {
  command: 'local/doctor',
  fixture: 'messy-merge',
  async setup({ root }) {
    editFrontmatter(root, 'ISS-7', 'priority: high\n', 'priority: critical\n')
    editFrontmatter(root, 'ISS-8', 'priority: medium\n', 'priority: medium\nparent: EPC-9\n')
  },
  prompt: '/pmkit:local:doctor',
  answers: ['No, leave ISS-4 as it is', 'Yes', 'Yes'],
  steps: [
    { step: '1', read: ['validate'], save: 'first' },
    // Step 2, ISS-4: both sides are shown and the user declines, so it stays in conflict.
    { step: '2.1', read: ['issues', 'get', 'ISS-4', '--history'], expectError: 'CONFLICT' },
    // Step 2, ISS-5: the resolution keeps in_review and is approved.
    { step: '2.1', read: ['issues', 'get', 'ISS-5', '--history'], expectError: 'CONFLICT' },
    { confirm: 'Step 2.3' },
    { step: '2.4', edit: { file: '.issues/issues/ISS-5/issue.md', content: resolved } },
    { step: '2.5', read: ['validate'], save: 'afterConflicts' },
    // Step 4: the allowed priorities, then one dry run per fix.
    { step: '4', read: ['discover'], save: 'discovered' },
    { step: '4', dryRun: priority },
    { step: '4', dryRun: parent },
    // Step 5: one preview of both fixes, then the same commands without --dry-run.
    { confirm: 'Step 5' },
    { step: '4', write: priority },
    { step: '4', write: parent },
    // Step 6 rebuilds the query index and asks nothing; step 7 validates a last time.
    { step: '6', read: ['reindex'], save: 'reindexed' },
    { step: '7', read: ['validate'], save: 'last' },
  ],
  skip: {
    '3 validate': 'validate reports no config or FORMAT problem, so step 3 has nothing to settle',
    '3 migrate': 'the tracker is on the current format, so there is no FORMAT problem to migrate',
    '4 issues move': 'no status value is invalid, so no issues move fix is proposed',
    '4 milestone create': 'no issue or epic names a milestone that does not exist',
    '4 issues link': 'no blocker, related or duplicate target is missing and there is no blocker loop',
    '4 cycle add': 'every sprint reference exists, so no issue moves to the backlog',
  },
  notHit: { 'Step 3': 'validate reports no config or FORMAT problem' },
  expect(repo, saved) {
    assert.match(repo.file('.issues/issues/ISS-4/issue.md'), /^<{7} HEAD$/m, 'ISS-4 keeps its markers')
    assert.equal(repo.issue('ISS-7').priority, 'high')
    assert.equal(repo.issue('ISS-8').parent, undefined)
    const codes = (result, file) => result.problems.filter((p) => p.path === `.issues/issues/${file}/issue.md`).map((p) => p.code)
    assert.deepEqual(codes(saved.first, 'ISS-5'), ['conflict'])
    assert.ok(codes(saved.first, 'ISS-7').includes('value'), 'setup gives step 4 a value problem')
    assert.ok(codes(saved.first, 'ISS-8').includes('reference'), 'setup gives step 4 a reference problem')
    assert.deepEqual(codes(saved.afterConflicts, 'ISS-5'), [], 'the resolution leaves ISS-5 without problems')
    assert.ok(saved.discovered.priorities.includes('high'))
    assert.deepEqual(codes(saved.last, 'ISS-4'), ['conflict'], 'the declined file stays in conflict')
    for (const id of ['ISS-5', 'ISS-7', 'ISS-8']) assert.deepEqual(codes(saved.last, id), [], `${id} has no problem left`)
    assert.doesNotMatch(repo.file('.issues/issues/ISS-5/issue.md'), /^(<{7}|={7}|>{7})/m)
    assert.equal(repo.issue('ISS-5').status, 'in_review')
    assert.equal(typeof saved.reindexed.written, 'boolean', 'reindex reports whether it wrote the index')
  },
}
