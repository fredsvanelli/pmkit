// A Local tracker with one record of each kind a migration moves, committed to a new git repository.
// Built through the Local tracker on a copy of the `basic` fixture, so the files are the ones pmkit writes.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { addMapEntry } from './lib/yaml-edit.mjs'

/** A clock that moves one second per call, from `start`. */
export function steppingClock(start = '2026-10-20T10:00:00Z') {
  let at = Date.parse(start)
  return () => new Date((at += 1000))
}

export const git = (root, ...args) => execFileSync('git', ['-c', 'user.name=pmkit', '-c', 'user.email=pmkit@example.com', ...args], { cwd: root, encoding: 'utf8' })

/** Commits every file under root, starting the repository when it has none. */
export function commitAll(root, message = 'fixture') {
  if (!fs.existsSync(path.join(root, '.git'))) git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '--allow-empty', '-m', message)
  return git(root, 'rev-parse', '--short', 'HEAD').trim()
}

/**
 * Writes the migration fixture into `root`, a copy of the `basic` fixture, and commits it.
 * Returns the ids by role.
 */
export function buildMigrationFixture(root, { now = steppingClock() } = {}) {
  const configFile = path.join(root, '.issues', 'config.yaml')
  let config = fs.readFileSync(configFile, 'utf8')
  config = addMapEntry(config, ['members'], 'ada', { name: 'Ada Lovelace', email: 'ada@example.com', availability: 1 })
  config = config.replace(/^labels: \[\]$/m, 'labels: [needs-criteria]')
  fs.writeFileSync(configFile, config)

  const tracker = createLocalTracker(root, { now, index: false })
  const actor = 'fred'
  const create = (input) => tracker.createIssue(input, actor).after.id
  const epic = tracker.createDeliverable({ title: 'Linear tracker adapter', start: '2026-10-01', target: '2026-12-01', description: 'Move the tracker to Linear.' }, actor).after.id
  const sprint = tracker.openCycle({ start: '2026-11-02', end: '2026-11-15', goal: 'Ship the adapter' }, actor).after?.id ?? '2026-11-02'

  const root_ = create({ title: 'Add the config loader', type: 'feature', parent: epic, priority: 'high', labels: ['needs-criteria'] })
  const child = create({ title: 'Read the config file', type: 'task', parent: root_, assignee: 'ada', sprint })
  const grandchild = create({ title: 'Parse the YAML subset', type: 'task', parent: child, description: 'Use the parser in yaml.mjs.', acceptanceCriteria: [{ text: 'Reads flow maps', done: false }] })
  const blocker = create({ title: 'Write the client', type: 'feature' })
  const blocked = create({ title: 'Write the adapter', type: 'feature', due: '2026-11-30' })
  tracker.link(blocker, blocked, 'blocks', actor)
  const relatedA = create({ title: 'Document the client', type: 'chore' })
  const relatedB = create({ title: 'Document the adapter', type: 'chore' })
  tracker.link(relatedA, relatedB, 'related', actor)
  const original = create({ title: 'Map the statuses', type: 'task' })
  const duplicate = create({ title: 'Map statuses again', type: 'task' })
  tracker.link(duplicate, original, 'duplicate', actor)

  const threaded = create({ title: 'Choose the request budget', type: 'task' })
  const first = tracker.comment(threaded, 'How many requests per hour?', actor)
  tracker.comment(threaded, 'About 2500.', 'ada', { replyTo: first.id })
  const resolved = create({ title: 'Pick the map format', type: 'task' })
  const question = tracker.comment(resolved, 'YAML or JSON?', 'ada')
  tracker.resolveThread(resolved, question.id, actor)

  const archived = create({ title: 'Old spike', type: 'chore' })
  tracker.archive(archived, actor)
  const done = create({ title: 'Measure the rate limit', type: 'task', estimate: 3 })
  tracker.moveToCategory(done, 'done', actor)
  tracker.logTime(done, 30, actor)
  tracker.publishStatusUpdate({ epic, health: 'on_track', body: 'The client works.' }, actor)

  commitAll(root, 'migration fixture')
  return {
    ids: { epic, sprint, root: root_, child, grandchild, blocker, blocked, relatedA, relatedB, duplicate, original, threaded, resolved, archived, done },
  }
}
