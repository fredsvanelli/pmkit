import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { boardData, roadmapData, sprintData } from './lib/render-data.mjs'
import { makeRepo } from './test-helpers.mjs'

const NOW = () => new Date('2026-10-23T12:00:00Z')

/** A tracker on a fresh team copy. `edit(root)` changes the copy first. */
function open(edit = () => {}) {
  const root = makeRepo('team')
  edit(root)
  const config = loadConfig(root)
  return { root, tracker: createLocalTracker(root, { config, now: NOW }), local: config.local }
}

/** Replaces `from` with `to` in a file of the copy, and fails when `from` is not there. */
function replaceIn(root, file, from, to) {
  const full = path.join(root, file)
  const text = fs.readFileSync(full, 'utf8')
  assert.ok(text.includes(from), `${file} holds ${from}`)
  fs.writeFileSync(full, text.replace(from, to))
}

const ids = (rows) => rows.map((row) => row.id)

describe('boardData', () => {
  test('groups the open issues by status, in category order', () => {
    const { tracker, local } = open()
    const data = boardData(tracker, local)
    assert.deepEqual(data.statuses.map((s) => s.name), ['triage', 'backlog', 'todo', 'in_progress', 'in_review'])
    assert.deepEqual(data.statuses.map((s) => ids(s.issues)), [['ISS-1V9Z'], ['ISS-3F7H', 'ISS-6J0B'], ['ISS-4M2S'], ['ISS-2X6D', 'ISS-5N1R'], ['ISS-8C4W']])
    assert.equal(data.done, 3)
    assert.equal(data.canceled, 1)
    assert.equal(data.asOf, '2026-10-22T17:00:00Z')
    assert.deepEqual(ids(data.problems), ['ISS-3Q6T'])
    assert.equal(data.unit, 'points')
  })

  test('lists open blockers only and shows members by name', () => {
    const { tracker, local } = open()
    const rows = boardData(tracker, local).statuses.flatMap((s) => s.issues)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    assert.deepEqual(byId['ISS-2X6D'].blockedBy, ['ISS-5N1R'])
    assert.deepEqual(byId['ISS-8C4W'].blockedBy, [])
    assert.equal(byId['ISS-2X6D'].assignee, 'Ana Souza')
    assert.equal(byId['ISS-1V9Z'].assignee, '')
    assert.deepEqual(byId['ISS-2X6D'].labels, ['billing', 'backend'])
    assert.equal(byId['ISS-2X6D'].estimate, 8)
    assert.equal(byId['ISS-6J0B'].estimate, null)
  })

  test('puts a status after the others of its category', () => {
    const { tracker, local } = open((root) => replaceIn(root, '.issues/config.yaml', '  canceled: { category: canceled }\n', '  canceled: { category: canceled }\n  ready: { category: todo }\n'))
    assert.deepEqual(boardData(tracker, local).statuses.map((s) => s.name), ['triage', 'backlog', 'todo', 'ready', 'in_progress', 'in_review'])
  })

  test('shows an assignee that is not a member as the id, and no member email', () => {
    const { tracker, local } = open((root) => replaceIn(root, '.issues/issues/ISS-1V9Z/issue.md', 'status: triage\n', 'status: triage\nassignee: ghost\n'))
    const data = boardData(tracker, local)
    assert.equal(data.statuses[0].issues[0].assignee, 'ghost')
    assert.ok(!JSON.stringify(data).includes('@example.com'))
  })

  test('an archived blocker in a terminal category does not block', () => {
    const { tracker, local } = open((root) => replaceIn(root, '.issues/issues/ISS-6J0B/issue.md', 'priority: low\n', 'priority: low\nblocked_by: [ISS-7D8K]\n'))
    const row = boardData(tracker, local).statuses[1].issues.find((r) => r.id === 'ISS-6J0B')
    assert.deepEqual(row.blockedBy, [])
  })
})

/** Adds `line` after the `key: ...` line of a frontmatter. */
const addAfter = (root, file, key, line) => {
  const full = path.join(root, file)
  const text = fs.readFileSync(full, 'utf8')
  const next = text.replace(new RegExp(`^(${key}: .*)$`, 'm'), `$1\n${line}`)
  assert.notEqual(next, text, `${file} has ${key}`)
  fs.writeFileSync(full, next)
}

function withMilestones(root) {
  fs.mkdirSync(path.join(root, '.issues/milestones'), { recursive: true })
  fs.writeFileSync(path.join(root, '.issues/milestones/v1.0.md'), '---\nname: Public webhooks launch\ndue: 2026-11-13\n---\n\nWebhooks are open to every customer.\n\nSecond paragraph.\n')
  addAfter(root, '.issues/epics/EPC-2M9D/epic.md', 'status', 'milestone: v1.0')
  addAfter(root, '.issues/issues/ISS-3F7H/issue.md', 'status', 'milestone: jira')
  addAfter(root, '.issues/issues/ISS-4P8A/issue.md', 'status', 'milestone: v1.0')
}

describe('roadmapData', () => {
  test('groups epics and issues by milestone file, then by unfiled name', () => {
    const { tracker, local } = open(withMilestones)
    tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'at_risk', body: 'Late' }, 'fred')
    const data = roadmapData(tracker, local)
    assert.deepEqual(data.groups.map((g) => [g.id, g.name, g.filed]), [['v1.0', 'Public webhooks launch', true], [null, 'jira', false]])
    const [v1, jira] = data.groups
    assert.equal(v1.due, '2026-11-13')
    assert.equal(v1.summary, 'Webhooks are open to every customer.')
    assert.equal(v1.issuesDone, 1)
    assert.equal(v1.issuesTotal, 1)
    assert.deepEqual(v1.epics, [{
      id: 'EPC-2M9D', title: 'Reliable webhooks and billing export', status: 'in_progress', start: '2026-09-28', target: '2026-11-13',
      done: 2, total: 5, points: 22, pointsDone: 8, health: 'at_risk', healthDate: '2026-10-23',
    }])
    assert.equal(jira.issuesTotal, 1)
    assert.equal(jira.issuesDone, 0)
    assert.deepEqual(jira.epics, [])
    assert.deepEqual(data.noMilestone, [])
    assert.equal(data.unit, 'points')
    assert.deepEqual(ids(data.problems), ['ISS-3Q6T'])
  })

  test('puts every epic under No milestone when nothing names one', () => {
    const { tracker, local } = open()
    const data = roadmapData(tracker, local)
    assert.deepEqual(data.groups, [])
    assert.deepEqual(ids(data.noMilestone), ['EPC-2M9D'])
    assert.equal(data.noMilestone[0].health, null)
    assert.equal(data.noMilestone[0].healthDate, null)
  })

  test('skips names used only by archived issues, and does not count canceled issues', () => {
    const { tracker, local } = open((root) => {
      addAfter(root, '.issues/issues/ISS-7D8K/issue.md', 'status', 'milestone: old')
      addAfter(root, '.issues/issues/ISS-0G5E/issue.md', 'status', 'milestone: jira')
      addAfter(root, '.issues/issues/ISS-3F7H/issue.md', 'status', 'milestone: jira')
    })
    const data = roadmapData(tracker, local)
    assert.deepEqual(data.groups.map((g) => g.name), ['jira'])
    assert.equal(data.groups[0].issuesTotal, 1)
  })
})

describe('sprintData', () => {
  test('reads the active sprint with its totals, capacity and sections', () => {
    const { tracker, local } = open()
    const data = sprintData(tracker, local, 'current')
    assert.deepEqual(data.sprint, { id: '2026-10-12', name: 'Sprint 2026-10-12', start: '2026-10-12', end: '2026-10-25', state: 'active', goal: 'Webhook retries and the billing export' })
    assert.deepEqual(data.totals, { issues: 4, points: 17, pointsDone: 0, byCategory: { todo: 1, in_progress: 2, in_review: 1 } })
    assert.deepEqual(data.capacity, [
      { member: 'Fred Vanelli', capacity: 8, assigned: 4, done: 0 },
      { member: 'Ana Souza', capacity: 10, assigned: 13, done: 0 },
    ])
    assert.deepEqual(data.sections.map((s) => [s.category, ids(s.issues)]), [['todo', ['ISS-4M2S']], ['in_progress', ['ISS-2X6D', 'ISS-5N1R']], ['in_review', ['ISS-8C4W']]])
    assert.equal(data.asOf, '2026-10-22T17:00:00Z')
    assert.deepEqual(ids(data.problems), ['ISS-3Q6T'])
  })

  test('reads a closed sprint by id', () => {
    const { tracker, local } = open()
    const data = sprintData(tracker, local, '2026-09-28')
    assert.equal(data.sprint.state, 'closed')
    assert.equal(data.totals.pointsDone, 10)
  })

  test('adds an Unassigned row last', () => {
    const { tracker, local } = open()
    tracker.moveToCycle(['ISS-3F7H'], '2026-10-12', 'fred')
    assert.deepEqual(sprintData(tracker, local, 'current').capacity.at(-1), { member: 'Unassigned', capacity: null, assigned: 2, done: 0 })
  })

  test('counts a canceled issue in the issues but not in the points', () => {
    const { tracker, local } = open((root) => addAfter(root, '.issues/issues/ISS-0G5E/issue.md', 'status', 'sprint: 2026-10-12\nestimate: 5'))
    const { totals } = sprintData(tracker, local, 'current')
    assert.equal(totals.issues, 5)
    assert.equal(totals.byCategory.canceled, 1)
    assert.equal(totals.points, 17)
  })

  test('fails with no active sprint, and with an unknown id', () => {
    const { tracker, local } = open((root) => replaceIn(root, '.issues/sprints/2026-10-12.yaml', 'state: active', 'state: closed'))
    assert.throws(() => sprintData(tracker, local, 'current'), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
    assert.throws(() => sprintData(tracker, local, 'nope'), { code: 'NOT_FOUND', message: 'sprint nope does not exist', nextStep: 'pmkit cycle list' })
  })
})
