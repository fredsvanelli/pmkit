import test from 'node:test'
import assert from 'node:assert/strict'
import { planBudget, planMigration } from './plan.mjs'
import { previewJson, previewText } from './preview.mjs'

const SOURCE = { system: 'local', path: '.issues', commit: '87cc467' }
const TARGET = { system: 'linear', workspace: 'acme', team: 'ACME' }
const HEADER = {
  source: '.issues/ (commit 87cc467)',
  target: 'Linear team ACME in workspace acme',
  sourceCounts: '165 issues, 10 epics, 3 sprints, 148 links, 88 comments, 0 status updates',
  targetCounts: 'team ACME holds 0 issues',
}
const RATE = { requests: { remaining: 2488, resetAt: '2026-10-28T21:06:00Z' } }
const EMPTY_SNAPSHOT = { system: 'local', people: [], labels: [], epics: [], sprints: [], issues: [], links: [], comments: [] }

const record = (key, source = {}) => ({ key, source: { id: key, ...source }, target: null, fields: {}, refs: {}, dropped: [] })

function smallPlan(options = {}) {
  const mapped = {
    records: {
      label: [record('needs-criteria', { title: 'needs-criteria' })],
      epic: [record('EPC-5', { title: 'Linear tracker adapter', summary: 'Backlog' })],
      issue: [
        record('ISS-1', { title: 'Add the config loader', summary: 'Done, parent EPC-1, sprint 2026-10-12 has no cycle' }),
        record('ISS-2', { title: 'Read the config file ok', summary: 'Todo' }),
      ],
      link: [record('blocks ISS-1 ISS-2', { id: 'ISS-1 blocks ISS-2', kind: 'blocks' })],
      comment: [record('ISS-1/c1', { title: 'Comment by Fred on 2026-10-28' })],
      thread: [record('ISS-1/c1', { title: 'resolved thread' })],
      update: [record('EPC-5/2026-10-28-fred', { title: 'on track' })],
      archive: [record('ISS-2', { title: 'Read the config file ok' })],
    },
    losses: [
      { what: 'sprints', count: 3, ids: ['2026-10-12'], why: '3 sprints have no Linear cycle with the same dates; 41 issues will have no cycle' },
      { what: 'milestones', count: 12, ids: [], why: '12 issues lose their milestone' },
    ],
    problems: [],
    people: [{ id: 'fred', name: 'Fred', email: 'fred@example.com', note: 'matches Linear user Fred' }],
    readRequests: 10,
    ...options.mapped,
  }
  return planMigration({ direction: 'export', source: SOURCE, target: TARGET, snapshot: EMPTY_SNAPSHOT, mapped, map: options.map ?? null, known: {} })
}

function bigPlan() {
  const many = (kind, n, source) => Array.from({ length: n }, (_, i) => record(`${kind}-${i + 1}`, source?.(i)))
  const links = many('LNK', 148, (i) => ({ kind: i < 86 ? 'blocks' : 'related' }))
  return planMigration({
    direction: 'export', source: SOURCE, target: TARGET, snapshot: EMPTY_SNAPSHOT, map: null, known: {},
    mapped: { records: { issue: many('ISS', 165), epic: many('EPC', 10), label: many('L', 2), link: links, comment: many('C', 88), thread: many('T', 3) }, losses: [], problems: [], people: [], readRequests: 10 },
  })
}

const lines = (text) => text.split('\n')
const indexOf = (text, start) => lines(text).findIndex((line) => line.startsWith(start))

test('the text preview has every section in order', () => {
  const plan = smallPlan()
  const text = previewText(plan, planBudget(plan, RATE), { dryRun: true, header: HEADER })
  const order = [
    'export .issues/ (commit 87cc467) to Linear team ACME in workspace acme',
    'source: 165 issues',
    'target: team ACME holds 0 issues',
    'step  what',
    'budget: ',
    'people',
    'epics',
    'issues',
    'links',
    'will not carry over',
    'digest: sha256:',
    'dry run: nothing was written',
  ]
  const at = order.map((start) => indexOf(text, start))
  assert.ok(at.every((i) => i >= 0), `missing a section in:\n${text}`)
  assert.deepEqual([...at].sort((a, b) => a - b), at)
  assert.equal(lines(text).at(-1), 'dry run: nothing was written')
  assert.equal(lines(text)[0], order[0])
  assert.ok(lines(text).includes('  fred   Fred <fred@example.com>   matches Linear user Fred'))
  assert.ok(lines(text).includes('  sprints      3 sprints have no Linear cycle with the same dates; 41 issues will have no cycle'))
  assert.ok(lines(text).includes('  milestones   12 issues lose their milestone'))
})

test('a run without --dry-run has no dry run line', () => {
  const plan = smallPlan()
  assert.doesNotMatch(previewText(plan, planBudget(plan, RATE), { dryRun: false, header: HEADER }), /dry run/)
})

test('the step table matches the spec example', () => {
  const plan = bigPlan()
  const text = previewText(plan, planBudget(plan, RATE), { dryRun: true, header: HEADER })
  const table = [
    'step  what                                         records  requests',
    '0     reads before the first write                       -        10',
    '1     labels to create                                   2         2',
    '2     epics as projects                                 10        10',
    '3     issues                                           165       165',
    '4     links (86 blocks, 62 related, 0 duplicate)       148       148',
    '5     comments                                          88        88',
    '6     resolved threads                                   3         3',
    '7     status updates                                     0         0',
    '8     archived issues                                    0         0',
    '      total                                                      426',
    'budget: 426 requests of 2488 left this hour (resets 21:06Z), 100 kept in reserve',
  ]
  const start = indexOf(text, 'step  what')
  assert.deepEqual(lines(text).slice(start, start + table.length), table)
})

test('a record line per record', () => {
  const plan = smallPlan()
  const text = previewText(plan, planBudget(plan, RATE), { dryRun: true, header: HEADER })
  assert.ok(lines(text).includes('  ISS-1   Add the config loader     new issue, Done, parent EPC-1, sprint 2026-10-12 has no cycle'), text)
  assert.ok(lines(text).includes('  EPC-5   Linear tracker adapter   new project, Backlog'), text)
  assert.ok(lines(text).some((line) => line.startsWith('  ISS-1 blocks ISS-2')), text)
})

test('a resume adds the done, sent and to-send column', () => {
  const map = { file: '.pmkit/migrations/2026-10-28-export-linear.yaml', map: { records: { issue: { 'ISS-1': { state: 'done', uuid: 'u1', id: 'ACME-12' }, 'ISS-2': { state: 'sent', uuid: 'u2' } } } } }
  const plan = smallPlan({ map })
  const text = previewText(plan, planBudget(plan, RATE), { dryRun: true, header: HEADER })
  assert.ok(lines(text).some((line) => /^step {2}what +records {2}requests {2}done\/sent\/to send$/.test(line)), text)
  assert.ok(lines(text).some((line) => /^3 +issues +2 +1 +1\/1\/1$/.test(line)), text)
  assert.ok(lines(text).some((line) => /^ {2}ISS-1 +Add the config loader +done ACME-12$/.test(line)), text)
  assert.ok(lines(text).includes('resume: .pmkit/migrations/2026-10-28-export-linear.yaml, 1 done, 1 sent, 0 failed'), text)
})

test('the budget line says where the run stops', () => {
  const plan = bigPlan()
  const text = previewText(plan, planBudget(plan, { requests: { remaining: 300, resetAt: '2026-10-28T21:06:00Z' } }), { dryRun: true, header: HEADER })
  assert.ok(lines(text).includes('budget: 426 requests of 300 left this hour (resets 21:06Z), 100 kept in reserve; the run stops after about 200 writes; run it again after 21:06Z to finish'), text)
})

test('the budget line says unknown without headers', () => {
  const plan = bigPlan()
  const text = previewText(plan, planBudget(plan, null), { dryRun: true, header: HEADER })
  assert.ok(lines(text).includes("budget: 426 requests; Linear has not said how many are left this hour"), text)
})

test('problems come before the step table and say the run will refuse', () => {
  const plan = smallPlan({ mapped: { problems: [{ kind: 'issue', key: 'ISS-1', code: 'no_state', message: 'no Linear state for in_review' }] } })
  const text = previewText(plan, planBudget(plan, RATE), { dryRun: true, header: HEADER })
  const problems = indexOf(text, 'problems: the run refuses until these are fixed')
  assert.ok(problems > 0 && problems < indexOf(text, 'step  what'), text)
  assert.equal(lines(text)[problems + 1], '  ISS-1   no Linear state for in_review')
})

test('an import has no budget line', () => {
  const plan = planMigration({
    direction: 'import', source: TARGET, target: SOURCE, snapshot: EMPTY_SNAPSHOT, map: null, known: {},
    mapped: { records: { member: [record('u1', { title: 'Ana', summary: 'new member ana' })] }, losses: [], problems: [], people: [], readRequests: 25 },
  })
  const text = previewText(plan, planBudget(plan, null), { dryRun: true, header: { source: 'Linear team ACME in workspace acme', target: '.issues/', sourceCounts: '1 issue', targetCounts: '.issues/ holds no issues' } })
  assert.equal(lines(text)[0], 'import Linear team ACME in workspace acme into .issues/')
  assert.doesNotMatch(text, /^budget/m)
  assert.ok(lines(text).some((line) => /^1 +new members +1 +0$/.test(line)), text)
})

test('previewJson has the spec keys', () => {
  const plan = smallPlan()
  const json = previewJson(plan, planBudget(plan, RATE))
  assert.deepEqual(Object.keys(json), ['direction', 'source', 'target', 'steps', 'records', 'people', 'losses', 'problems', 'budget', 'resume', 'digest'])
  assert.deepEqual(Object.keys(json.records), ['label', 'epic', 'issue', 'link', 'comment', 'thread', 'update', 'archive'])
  assert.deepEqual(json.records.issue[0], { source: 'ISS-1', action: 'create', target: null, fields: {}, dropped: [] })
  assert.deepEqual(Object.keys(json.budget), ['requests', 'remaining', 'reserve', 'resetAt', 'fits'])
  assert.equal(json.digest, plan.digest)
})
