import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ISSUE_KEYS, parseIssueFile, serializeIssue, toFrontmatter } from './lib/local/issue-file.mjs'

const statuses = {
  backlog: { category: 'backlog' },
  in_progress: { category: 'in_progress' },
  done: { category: 'done' },
}

const SPEC_FILE = `---
id: ISS-7K3Q
title: Retry failed webhook deliveries
type: bug
status: in_progress
priority: high
estimate: 3
assignee: fred
labels: [backend, webhooks]
parent: EPC-2M9D
blocked_by: [ISS-4P8A]
sprint: 2026-11-02
due: 2026-11-14
branch: iss-7k3q-retry-webhooks
created: 2026-10-23T21:12:00Z
updated: 2026-10-24T13:40:00Z
---

## Description

Deliveries that fail with 5xx are dropped instead of retried.

## Acceptance criteria

- [ ] Retries with exponential backoff, max 5 attempts
- [ ] Dead-letter after the last attempt
`

const parse = (text) => parseIssueFile(text, { statuses })

test('ISSUE_KEYS fixes the frontmatter order', () => {
  assert.deepEqual(ISSUE_KEYS, [
    'id', 'title', 'type', 'status', 'priority', 'estimate', 'assignee', 'labels', 'parent',
    'blocked_by', 'related', 'duplicate_of', 'sprint', 'milestone', 'release', 'due', 'branch', 'archived',
    'created', 'updated',
  ])
})

test('release parses, and serializes on the line after milestone', () => {
  const text = SPEC_FILE.replace('sprint: 2026-11-02\n', 'sprint: 2026-11-02\nmilestone: v2\nrelease: 1.2.0\n')
  const issue = parse(text)
  assert.equal(issue.release, '1.2.0')
  assert.equal(issue.extra, undefined)
  assert.equal(toFrontmatter(issue).release, '1.2.0')
  assert.match(serializeIssue(issue), /^milestone: v2\nrelease: 1\.2\.0\ndue: /m)
})

test('a release key written after updated by the previous plugin is read as release and moves before due', () => {
  const text = SPEC_FILE.replace('updated: 2026-10-24T13:40:00Z\n', 'updated: 2026-10-24T13:40:00Z\nrelease: 1.0.0\n')
  const issue = parse(text)
  assert.equal(issue.release, '1.0.0')
  assert.equal(issue.extra, undefined)
  assert.match(serializeIssue(issue), /^release: 1\.0\.0\ndue: 2026-11-14$/m)
})

test('the spec issue file parses to the expected Issue', () => {
  const issue = parse(SPEC_FILE)
  assert.deepEqual(issue, {
    id: 'ISS-7K3Q',
    title: 'Retry failed webhook deliveries',
    type: 'bug',
    status: { name: 'in_progress', category: 'in_progress' },
    priority: 'high',
    estimate: 3,
    assignee: 'fred',
    labels: ['backend', 'webhooks'],
    parent: 'EPC-2M9D',
    blockedBy: ['ISS-4P8A'],
    blocks: [],
    related: [],
    duplicateOf: [],
    children: [],
    archived: false,
    sprint: '2026-11-02',
    due: '2026-11-14',
    branch: 'iss-7k3q-retry-webhooks',
    description: 'Deliveries that fail with 5xx are dropped instead of retried.',
    acceptanceCriteria: [
      { text: 'Retries with exponential backoff, max 5 attempts', done: false },
      { text: 'Dead-letter after the last attempt', done: false },
    ],
    created: '2026-10-23T21:12:00Z',
    updated: '2026-10-24T13:40:00Z',
    body: SPEC_FILE.slice(SPEC_FILE.indexOf('## Description')),
  })
})

test('an unknown status gets a null category and archived true is read', () => {
  const issue = parse(SPEC_FILE.replace('status: in_progress', 'status: waiting').replace('branch:', 'archived: true\nbranch:'))
  assert.deepEqual(issue.status, { name: 'waiting', category: null })
  assert.equal(issue.archived, true)
})

test('CRLF and a BOM parse to the same Issue', () => {
  const crlf = '\uFEFF' + SPEC_FILE.replace(/\n/g, '\r\n')
  assert.deepEqual(parse(crlf), parse(SPEC_FILE))
  assert.equal(serializeIssue(parse(crlf)), SPEC_FILE)
})

test('serializeIssue(parseIssueFile(x)) equals x for the spec file', () => {
  assert.equal(serializeIssue(parse(SPEC_FILE)), SPEC_FILE)
})

test('toFrontmatter maps the model to frontmatter values', () => {
  const frontmatter = toFrontmatter(parse(SPEC_FILE))
  assert.equal(frontmatter.status, 'in_progress')
  assert.deepEqual(frontmatter.blocked_by, ['ISS-4P8A'])
  assert.equal('blocks' in frontmatter, false)
  assert.equal('children' in frontmatter, false)
  assert.equal('description' in frontmatter, false)
  assert.equal('body' in frontmatter, false)
})

test('toggling a criterion changes only that line', () => {
  const issue = parse(SPEC_FILE)
  issue.acceptanceCriteria[0].done = true
  const expected = SPEC_FILE.replace('- [ ] Retries', '- [x] Retries')
  assert.equal(serializeIssue(issue), expected)
  assert.equal(parse(expected).acceptanceCriteria[0].done, true)
  assert.equal(parse(expected.replace('[x]', '[X]')).acceptanceCriteria[0].done, true)
})

test('a Notes section between the known ones stays in place after a description change', () => {
  const text = SPEC_FILE.replace('## Acceptance criteria', '## Notes\n\nAsk Dana about the queue.\n\n## Acceptance criteria')
  const issue = parse(text)
  issue.description = 'Failed deliveries are retried.'
  assert.equal(serializeIssue(issue), text.replace('Deliveries that fail with 5xx are dropped instead of retried.', 'Failed deliveries are retried.'))
})

test('a missing section is appended in the order Description, Acceptance criteria', () => {
  const head = SPEC_FILE.slice(0, SPEC_FILE.indexOf('## Description'))
  const issue = parse(head)
  issue.acceptanceCriteria = [{ text: 'It works', done: true }]
  issue.description = 'Why.'
  assert.equal(serializeIssue(issue), `${head}## Description\n\nWhy.\n\n## Acceptance criteria\n\n- [x] It works\n`)
})

test('a file with conflict markers throws CONFLICT, also inside the frontmatter', () => {
  const body = SPEC_FILE.replace('## Acceptance criteria', '<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> other\n## Acceptance criteria')
  const front = SPEC_FILE.replace('type: bug', '<<<<<<< HEAD\ntype: bug\n=======\ntype: task\n>>>>>>> other')
  for (const text of [body, front]) {
    assert.throws(
      () => parse(text),
      (error) => error.code === 'CONFLICT' && error.nextStep === '/pmkit:local:doctor',
    )
  }
})

test('a file without frontmatter, or with broken frontmatter, throws INVALID_INPUT', () => {
  for (const text of ['## Description\n\nNo header.\n', '---\nid: [unclosed\n---\n\nbody\n']) {
    assert.throws(() => parse(text), (error) => error.code === 'INVALID_INPUT')
  }
})

test('unknown frontmatter keys go to extra and are written back after the known ones', () => {
  const text = SPEC_FILE.replace('type: bug\n', 'type: bug\nteam: payments\nreviewers: [ana, fred]\n')
  const issue = parse(text)
  assert.deepEqual(issue.extra, { team: 'payments', reviewers: ['ana', 'fred'] })
  assert.equal(toFrontmatter(issue).team, 'payments')
  const written = serializeIssue(issue)
  assert.equal(written, SPEC_FILE.replace('updated: 2026-10-24T13:40:00Z\n', 'updated: 2026-10-24T13:40:00Z\nreviewers: [ana, fred]\nteam: payments\n'))
  assert.deepEqual(parse(written), { ...issue, body: issue.body })
  assert.equal('extra' in parse(SPEC_FILE), false)
})
