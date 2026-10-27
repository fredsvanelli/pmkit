import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { boardData } from './lib/render-data.mjs'
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
