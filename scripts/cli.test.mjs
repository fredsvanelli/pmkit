import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'
import { COMMANDS, configClass } from './pmkit.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')

function baseEnv() {
  const env = {
    ...process.env,
    PMKIT_USER: 'fred',
    PMKIT_NOW: '2026-10-23T12:00:00Z',
    PMKIT_SEED: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  }
  return env
}

function run(cwd, args, { env = {}, input } = {}) {
  const merged = { ...baseEnv(), ...env }
  for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key]
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: merged, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (cwd, args, options) => {
  const result = run(cwd, [...args, '--json'], options)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })

test('init scaffolds every file in an empty git repo and refuses a second run with CONFLICT', () => {
  const dir = tempDir('pmkit-init-')
  git(dir, 'init', '-q')
  const first = run(dir, ['init', '--tracker', 'local', '--member', 'fred', '--name', 'Fred', '--email', 'f@x.dev'])
  assert.equal(first.status, 0, first.stderr)
  for (const file of [
    '.pmkit/config.yaml', '.issues/config.yaml', '.issues/.gitattributes', '.issues/.gitignore',
    '.issues/issues/.gitkeep', '.issues/epics/.gitkeep', '.issues/sprints/.gitkeep', '.issues/docs/.gitkeep',
  ]) assert.ok(fs.existsSync(path.join(dir, file)), `${file} exists`)
  assert.match(fs.readFileSync(path.join(dir, '.pmkit/config.yaml'), 'utf8'), /system: none/)
  const members = json(dir, ['discover']).members
  assert.deepEqual(members.map((m) => [m.id, m.name, m.email]), [['fred', 'Fred', 'f@x.dev']])
  const second = run(dir, ['init', '--tracker', 'local', '--json'])
  assert.equal(second.status, 2)
  assert.equal(JSON.parse(second.stdout).error.code, 'CONFLICT')
})

test('init --dry-run lists the files and writes nothing', () => {
  const dir = tempDir('pmkit-init-')
  const result = run(dir, ['init', '--root', dir, '--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\.pmkit\/config\.yaml/)
  assert.equal(fs.readdirSync(dir).length, 0)
})

test('init takes the GitHub repo from the origin remote', () => {
  const dir = tempDir('pmkit-init-')
  git(dir, 'init', '-q')
  git(dir, 'remote', 'add', 'origin', 'git@github.com:fredsvanelli/skills.git')
  assert.equal(run(dir, ['init', '--git-host', 'github', '--prefix', 'ABC']).status, 0)
  const text = fs.readFileSync(path.join(dir, '.pmkit/config.yaml'), 'utf8')
  assert.match(text, /system: github/)
  assert.match(text, /repo: fredsvanelli\/skills/)
  assert.match(fs.readFileSync(path.join(dir, '.issues/config.yaml'), 'utf8'), /id_prefix: ABC/)
})

test('issues create prints an issue with an id and issues list returns it', () => {
  const root = makeRepo('basic')
  const created = json(root, ['issues', 'create', '--title', 'First'])
  assert.match(created.after.id, /^ISS-[0-9A-Z]{4}$/)
  assert.equal(created.before, null)
  const listed = json(root, ['issues', 'list'])
  assert.deepEqual(listed.issues.map((issue) => issue.id), [created.after.id])
  assert.deepEqual(listed.problems, [])
  const text = run(root, ['issues', 'list'])
  assert.match(text.stdout, /ID\s+\| Title\s+\| Status\s+\| Assignee\s+\| Estimate\s+\| Sprint/)
  assert.match(text.stdout, new RegExp(`${created.after.id}\\s+\\| First\\s+\\| backlog`))
})

test('issues move prints status: backlog → in_progress', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  const moved = run(root, ['issues', 'move', after.id, 'in_progress'])
  assert.equal(moved.status, 0, moved.stderr)
  assert.match(moved.stdout, /status: backlog → in_progress/)
})

test('issues update --dry-run prints the change and leaves the repo byte-identical', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  const before = hashTree(root)
  const result = run(root, ['issues', 'update', after.id, '--priority', 'high', '--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /priority: \(none\) → high/)
  assert.match(result.stdout, /dry run/)
  assert.equal(hashTree(root), before)
})

test('every write is byte-identical on --dry-run', () => {
  const root = makeRepo('team')
  const commentFile = path.join(tempDir('pmkit-body-'), 'c.md')
  fs.writeFileSync(commentFile, 'A comment.')
  const before = hashTree(root)
  const dry = (...args) => {
    const result = run(root, [...args, '--dry-run'])
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`)
  }
  dry('issues', 'create', '--title', 'New')
  dry('issues', 'move', 'ISS-3F7H', 'done')
  dry('issues', 'assign', 'ISS-3F7H', 'ana')
  dry('issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'related')
  dry('issues', 'parent', 'ISS-3F7H', 'none')
  dry('issues', 'archive', 'ISS-3F7H')
  dry('issues', 'log-time', 'ISS-3F7H', '30')
  dry('cycle', 'open', '--start', '2026-11-02')
  dry('cycle', 'add', 'ISS-3F7H', '--to', 'none')
  dry('cycle', 'capacity', '2026-10-12', '--set', 'fred=3')
  dry('cycle', 'close', '2026-10-12')
  dry('epic', 'create', '--title', 'E')
  dry('issues', 'update', 'ISS-3F7H', '--priority', 'urgent', '--estimate', '8')
  dry('issues', 'comment', 'ISS-3F7H', '--body-file', commentFile)
  dry('epic', 'update-status', 'EPC-2M9D', '--health', 'at_risk', '--body-file', commentFile)
  assert.equal(hashTree(root), before)
})

test('issues get on an unknown id exits 2 with error and next on stderr', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'get', 'NOPE-1234'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^error: /m)
  assert.match(result.stderr, /^next: /m)
  assert.equal(result.stdout, '')
})

test('with --json the same error is a JSON object on stdout', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'get', 'NOPE-1234', '--json'])
  assert.equal(result.status, 2)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_FOUND')
  assert.ok(error.message)
  assert.ok(error.nextStep)
})

test('a bad PMKIT_NOW is a usage error', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'create', '--title', 'x'], { env: { PMKIT_NOW: 'not a date' } })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^error: /m)
})

test('cycle open, add and current', () => {
  const root = makeRepo('basic')
  const { after: issue } = json(root, ['issues', 'create', '--title', 'First'])
  const opened = json(root, ['cycle', 'open', '--start', '2026-10-19'])
  assert.equal(opened.after.id, '2026-10-19')
  assert.equal(opened.after.end, '2026-11-01')
  const moved = json(root, ['cycle', 'add', issue.id, '--to', '2026-10-19'])
  assert.equal(moved[0].after.sprint, '2026-10-19')
  const current = json(root, ['cycle', 'current'])
  assert.equal(current.id, '2026-10-19')
  assert.equal(current.state, 'active')
  const inSprint = json(root, ['cycle', 'issues', '2026-10-19'])
  assert.deepEqual(inSprint.map((i) => i.id), [issue.id])
  const none = json(root, ['cycle', 'add', issue.id, '--to', 'none'])
  assert.equal(none[0].after.sprint, undefined)
})

test('epic create, issues parent and epic progress', () => {
  const root = makeRepo('basic')
  const { after: epic } = json(root, ['epic', 'create', '--title', 'E'])
  const { after: issue } = json(root, ['issues', 'create', '--title', 'First'])
  json(root, ['issues', 'parent', issue.id, epic.id])
  const progress = json(root, ['epic', 'progress', epic.id])
  assert.equal(progress.total, 1)
  assert.equal(progress.done, 0)
  assert.match(run(root, ['epic', 'list']).stdout, new RegExp(`${epic.id}\\s+\\| E`))
})

const TEAM_EPIC_MAP = `EPC-2M9D  Reliable webhooks and billing export  in_progress
critical path: ISS-5N1R → ISS-2X6D (11 points)

blocker chain:
* ISS-2X6D  Billing export to CSV  in_progress  ana  8
  * ISS-5N1R  Paginate the events API  in_progress  fred  3  (outside EPC-2M9D)

hierarchy:
* ISS-2X6D  Billing export to CSV  in_progress  ana  8  blocked by ISS-5N1R
    ISS-4M2S  Fix CSV column order  todo  fred  1
  ISS-8C4W  Dead-letter queue for webhooks  in_review  ana  5
  2 done or canceled
1 resolved blocker not shown
`

test('issues dependencies on an epic prints the critical path, the blocker chain and the hierarchy', () => {
  const root = makeRepo('team')
  const result = run(root, ['issues', 'dependencies', 'EPC-2M9D'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, TEAM_EPIC_MAP)
  assert.match(result.stderr, /^warning: ISS-3Q6T: CONFLICT /m)
  const map = json(root, ['issues', 'dependencies', 'EPC-2M9D'])
  assert.equal(map.basis, 'blockers')
  assert.equal(map.reason, null)
  assert.deepEqual(map.weight, { unit: 'points' })
  assert.deepEqual(map.criticalPath, { ids: ['ISS-5N1R', 'ISS-2X6D'], length: 11, unestimated: [] })
  assert.equal(map.resolved, 1)
  assert.deepEqual(map.related, [['ISS-2X6D', 'ISS-0G5E']])
  assert.deepEqual(map.target.ancestors, [])
  assert.deepEqual(map.nodes.map((node) => node.id), ['ISS-7K3Q', 'ISS-4P8A', 'ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W', 'ISS-4M2S'])
  assert.deepEqual(map.problems, [{ id: 'ISS-3Q6T', code: 'CONFLICT', message: 'The issue file contains git conflict markers.' }])
})

test('issues dependencies on an issue shows its parents and its sub-issues', () => {
  const root = makeRepo('team')
  const map = json(root, ['issues', 'dependencies', 'ISS-2X6D'])
  assert.equal(map.target.kind, 'issue')
  assert.deepEqual(map.target.ancestors, ['EPC-2M9D'])
  assert.deepEqual(map.tree, [{ id: 'ISS-2X6D', children: [{ id: 'ISS-4M2S', children: [] }] }])
  assert.deepEqual(map.criticalPath.ids, ['ISS-5N1R', 'ISS-2X6D'])
  const { stdout } = run(root, ['issues', 'dependencies', 'ISS-2X6D'])
  assert.ok(stdout.startsWith('ISS-2X6D  Billing export to CSV  in_progress\nparents: EPC-2M9D\ncritical path: ISS-5N1R → ISS-2X6D (11 points)\n'), stdout)
  assert.ok(stdout.includes('(outside ISS-2X6D)'), stdout)
})

test('issues dependencies with no blocker shows the hierarchy only and says why', () => {
  const root = makeRepo('no-sprints')
  const result = run(root, ['issues', 'dependencies', 'EPC-4H7V'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `EPC-4H7V  Reliable webhooks  in_progress
no open issue in the scope of EPC-4H7V has a blocker, so this shows the hierarchy only

hierarchy:
  2 done or canceled
`)
  const map = json(root, ['issues', 'dependencies', 'EPC-4H7V'])
  assert.equal(map.basis, 'hierarchy')
  assert.equal(map.reason, 'none')
  assert.equal(map.criticalPath, null)
})

test('issues dependencies says when every blocker is done', () => {
  const root = makeRepo('team')
  const map = json(root, ['issues', 'dependencies', 'ISS-8C4W'])
  assert.equal(map.reason, 'resolved')
  assert.equal(map.resolved, 1)
  const lines = run(root, ['issues', 'dependencies', 'ISS-8C4W']).stdout.trimEnd().split('\n')
  assert.deepEqual(lines.slice(0, 3), [
    'ISS-8C4W  Dead-letter queue for webhooks  in_review',
    'parents: EPC-2M9D',
    'every blocker of ISS-8C4W is done or canceled, so this shows the hierarchy only',
  ])
  assert.equal(lines.at(-1), '1 resolved blocker not shown')
})

test('issues dependencies on an unknown id is NOT_FOUND', () => {
  const root = makeRepo('team')
  for (const id of ['ISS-ZZZZ', 'EPC-ZZZZ']) {
    const result = run(root, ['issues', 'dependencies', id, '--json'])
    assert.equal(result.status, 2, id)
    assert.equal(JSON.parse(result.stdout).error.code, 'NOT_FOUND', id)
  }
})

test('issues dependencies writes nothing and takes no write flag', () => {
  const root = makeRepo('team')
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@x.dev')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'fixture')
  for (const id of ['EPC-2M9D', 'ISS-2X6D']) {
    assert.equal(run(root, ['issues', 'dependencies', id]).status, 0)
    json(root, ['issues', 'dependencies', id])
  }
  assert.equal(git(root, 'status', '--porcelain').stdout, '')
  const dryRun = run(root, ['issues', 'dependencies', 'EPC-2M9D', '--dry-run'])
  assert.equal(dryRun.status, 2)
  assert.match(dryRun.stderr, /unknown option --dry-run/)
  const as = run(root, ['issues', 'dependencies', 'EPC-2M9D', '--as', 'fred'])
  assert.equal(as.status, 2)
  assert.match(as.stderr, /unknown option --as/)
})

test('issues dependencies breaks a hand-made loop and still answers', () => {
  const root = makeRepo('team')
  const file = path.join(root, '.issues', 'issues', 'ISS-5N1R', 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('created:', 'blocked_by: [ISS-2X6D]\ncreated:'))
  const map = json(root, ['issues', 'dependencies', 'EPC-2M9D'])
  assert.deepEqual(map.criticalPath.ids, ['ISS-5N1R', 'ISS-2X6D'])
  const result = run(root, ['issues', 'dependencies', 'EPC-2M9D'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^warning: ISS-5N1R: cycle blocked_by loop: ISS-2X6D → ISS-5N1R → ISS-2X6D; run \/pmkit:local:doctor$/m)
})

test('issues dependencies prints a shared blocker once and a missing one as missing', () => {
  const root = makeRepo('team')
  const file = path.join(root, '.issues', 'issues', 'ISS-8C4W', 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('blocked_by: [ISS-7K3Q]', 'blocked_by: [ISS-7K3Q, ISS-5N1R, ISS-ZZZZ]'))
  const { stdout } = run(root, ['issues', 'dependencies', 'EPC-2M9D'])
  const lines = stdout.split('\n')
  assert.equal(lines.filter((line) => line === '  * ISS-5N1R  Paginate the events API  in_progress  fred  3  (outside EPC-2M9D)  (shown above)').length, 1, stdout)
  assert.ok(lines.includes('    ISS-ZZZZ  (missing)'), stdout)
  const map = json(root, ['issues', 'dependencies', 'EPC-2M9D'])
  assert.deepEqual(map.criticalPath.ids, ['ISS-5N1R', 'ISS-2X6D'])
  assert.equal(map.nodes.filter((node) => node.id === 'ISS-5N1R').length, 1)
  assert.equal(map.nodes.find((node) => node.id === 'ISS-ZZZZ').missing, true)
  assert.equal(map.resolved, 1)
})

test('issues dependencies on an empty epic and on a done issue', () => {
  const basic = makeRepo('basic')
  const { after: epic } = json(basic, ['epic', 'create', '--title', 'E'])
  assert.deepEqual(json(basic, ['issues', 'dependencies', epic.id]).tree, [])
  assert.ok(run(basic, ['issues', 'dependencies', epic.id]).stdout.endsWith('hierarchy:\n  no issues\n'))
  const team = makeRepo('team')
  assert.equal(json(team, ['issues', 'dependencies', 'ISS-7K3Q']).reason, 'none')
  assert.ok(run(team, ['issues', 'dependencies', 'ISS-7K3Q']).stdout.includes('  ISS-7K3Q  Retry failed webhook deliveries  done  fred  3'))
})

test('epic update-status publishes the body from stdin', () => {
  const root = makeRepo('team')
  const result = run(root, ['epic', 'update-status', 'EPC-2M9D', '--health', 'at_risk', '--body-file', '-'], { input: 'Late on retries.\n' })
  assert.equal(result.status, 0, result.stderr)
  const { after } = JSON.parse(run(root, ['epic', 'update-status', 'EPC-2M9D', '--health', 'on_track', '--body-file', '-', '--json'], { input: 'Back.\n' }).stdout)
  assert.equal(after.health, 'on_track')
  assert.equal(after.body, 'Back.')
})

test('metrics velocity on the team fixture', () => {
  const root = makeRepo('team')
  const result = json(root, ['metrics', 'velocity'])
  assert.deepEqual(result.perSprint, [{ id: '2026-09-28', points: 10, count: 3 }])
  assert.equal(result.average, 10)
  assert.equal(result.unit, 'points')
  assert.match(run(root, ['metrics', 'velocity']).stdout, /2026-09-28\s+\| 10\s+\| 3/)
})

test('metrics velocity falls back to the end date for a malformed closed', () => {
  const root = makeRepo('team')
  fs.appendFileSync(path.join(root, '.issues', 'sprints', '2026-09-28.yaml'), 'closed: 2026-10-26\n')
  assert.deepEqual(json(root, ['metrics', 'velocity']).perSprint, [{ id: '2026-09-28', points: 10, count: 3 }])
})

test('metrics cycle-time summarizes done issues in range', () => {
  const root = makeRepo('team')
  const all = json(root, ['metrics', 'cycle-time'])
  assert.deepEqual([all.count, all.median, all.p85], [3, 7.3, 8])
  assert.deepEqual(all.issues.map((i) => i.issue).sort(), ['ISS-4P8A', 'ISS-7K3Q', 'ISS-9T2M'])
  assert.equal(json(root, ['metrics', 'cycle-time', '--until', '2026-10-08']).count, 3)
  assert.equal(json(root, ['metrics', 'cycle-time', '--until', '2026-10-07']).count, 2)
  const none = json(root, ['metrics', 'cycle-time', '--since', '2030-01-01'])
  assert.equal(none.count, 0)
  assert.equal(none.median, null)
})

test('metrics lead-time summarizes done issues in range', () => {
  const root = makeRepo('team')
  const all = json(root, ['metrics', 'lead-time'])
  assert.deepEqual([all.count, all.median, all.p85], [3, 10.3, 11.7])
  assert.deepEqual(all.issues.map((i) => i.issue).sort(), ['ISS-4P8A', 'ISS-7K3Q', 'ISS-9T2M'])
  assert.equal(json(root, ['metrics', 'lead-time', '--until', '2026-10-07']).count, 2)
  assert.deepEqual(json(root, ['metrics', 'lead-time', '--since', '2026-10-06', '--until', '2026-10-08']).issues.map((i) => i.issue).sort(), ['ISS-4P8A', 'ISS-7K3Q'])
  const none = json(root, ['metrics', 'lead-time', '--since', '2030-01-01'])
  assert.equal(none.count, 0)
  assert.equal(none.median, null)
  assert.equal(run(root, ['metrics', 'lead-time', '--since', '2026-10-6']).status, 2)
  assert.equal(run(root, ['metrics', 'lead-time']).stdout, 'count: 3\nmedian: 10.3 days\np85: 11.7 days\n')
})

test('metrics throughput counts done issues by type in range', () => {
  const root = makeRepo('team')
  const all = json(root, ['metrics', 'throughput'])
  assert.deepEqual(all, {
    count: 3,
    byType: { bug: 2, feature: 1 },
    issues: [
      { issue: 'ISS-9T2M', type: 'bug', doneAt: '2026-10-05T15:00:00Z' },
      { issue: 'ISS-7K3Q', type: 'bug', doneAt: '2026-10-06T16:00:00Z' },
      { issue: 'ISS-4P8A', type: 'feature', doneAt: '2026-10-08T17:00:00Z' },
    ],
  })
  assert.equal(json(root, ['metrics', 'throughput', '--since', '2026-10-06', '--until', '2026-10-08']).count, 2)
  assert.deepEqual(json(root, ['metrics', 'throughput', '--since', '2030-01-01']), { count: 0, byType: {}, issues: [] })
  assert.equal(run(root, ['metrics', 'throughput']).stdout, 'count: 3\nType    | Issues\n--------|-------\nbug     | 2\nfeature | 1\n')
  assert.equal(run(root, ['metrics', 'throughput', '--since', '2030-01-01']).stdout, 'count: 0\n')
})

test('metrics throughput reads a time without a zone as UTC', () => {
  const root = makeRepo('team')
  const result = json(root, ['metrics', 'throughput', '--since', '2026-10-06T16:00:00', '--until', '2026-10-08T17:00'], { env: { TZ: 'America/Sao_Paulo' } })
  assert.deepEqual(result.issues.map((i) => i.issue), ['ISS-7K3Q', 'ISS-4P8A'])
})

test('metrics aging lists the work in progress at the clock', () => {
  const root = makeRepo('team')
  const data = json(root, ['metrics', 'aging'])
  assert.equal(data.asOf, '2026-10-23T12:00:00Z')
  assert.deepEqual([data.count, data.median, data.p85], [3, 8.1, 8.8])
  assert.deepEqual(data.issues.map((i) => [i.issue, i.status, i.days]), [['ISS-2X6D', 'in_progress', 9.1], ['ISS-8C4W', 'in_review', 8.1], ['ISS-5N1R', 'in_progress', 1.1]])
  const text = run(root, ['metrics', 'aging']).stdout
  assert.match(text, /^ISS-2X6D \| in_progress \| 2026-10-14T09:00:00Z \| 9\.1$/m)
  assert.ok(text.endsWith('count: 3\nmedian: 8.1 days\np85: 8.8 days\nas of: 2026-10-23T12:00:00Z\n'))
})

test('metrics aging takes --until as the as-of date', () => {
  const root = makeRepo('team')
  const at20 = json(root, ['metrics', 'aging', '--until', '2026-10-20'])
  assert.equal(at20.asOf, '2026-10-20T23:59:59Z')
  assert.deepEqual(at20.issues.map((i) => [i.issue, i.status, i.days]), [['ISS-2X6D', 'in_progress', 6.6], ['ISS-8C4W', 'in_progress', 5.6]])
  const at01 = json(root, ['metrics', 'aging', '--until', '2026-10-01'])
  assert.deepEqual(at01.issues.map((i) => [i.issue, i.status, i.days]), [['ISS-7K3Q', 'in_progress', 2.6], ['ISS-4P8A', 'in_progress', 1.6], ['ISS-9T2M', 'in_progress', 0.6]])
  assert.equal(json(root, ['metrics', 'aging', '--until', '2026-10-20T10:00:00']).asOf, '2026-10-20T10:00:00Z')
  assert.equal(run(root, ['metrics', 'aging', '--until', '2026-09-20']).stdout, 'no work in progress\nas of: 2026-09-20T23:59:59Z\n')
})

test('metrics aging reports as-of in whole seconds', () => {
  const root = makeRepo('team')
  assert.equal(json(root, ['metrics', 'aging'], { env: { PMKIT_NOW: '2026-10-24T12:00:00.167Z' } }).asOf, '2026-10-24T12:00:00Z')
  assert.equal(json(root, ['metrics', 'aging', '--until', '2026-10-20T10:00:00.5']).asOf, '2026-10-20T10:00:00Z')
})

test('PMKIT_NOW sets the as-of date of metrics aging', () => {
  const root = makeRepo('team')
  const data = json(root, ['metrics', 'aging'], { env: { PMKIT_NOW: '2026-10-24T12:00:00Z' } })
  assert.equal(data.asOf, '2026-10-24T12:00:00Z')
  assert.equal(data.issues.find((i) => i.issue === 'ISS-2X6D').days, 10.1)
})

test('metrics aging refuses --since and a bad --until', () => {
  const root = makeRepo('team')
  const since = run(root, ['metrics', 'aging', '--since', '2026-10-01', '--json'])
  assert.equal(since.status, 2)
  const error = JSON.parse(since.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /--since/)
  assert.equal(run(root, ['metrics', 'aging', '--until', '2026-10-2']).status, 2)
})

test('metrics cycle-time refuses a bound that is not a date', () => {
  const root = makeRepo('team')
  assert.equal(run(root, ['metrics', 'cycle-time', '--since', '2026-13-40', '--json']).status, 2)
  assert.equal(run(root, ['metrics', 'cycle-time', '--since', '2026-02-30', '--json']).status, 2)
  assert.equal(run(root, ['metrics', 'aging', '--until', '2026-02-30', '--json']).status, 2)
  const bad = run(root, ['metrics', 'cycle-time', '--until', '2026-10-08T1', '--json'])
  assert.equal(bad.status, 2)
  const error = JSON.parse(bad.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /--until/)
})

test('events prints the events in a range', () => {
  const root = makeRepo('team')
  const events = json(root, ['events', '--since', '2026-10-01'])
  assert.ok(events.length > 0)
  assert.ok(events.every((event) => event.at >= '2026-10-01' && event.issue))
  assert.match(run(root, ['events', '--since', '2026-10-01']).stdout, /ISS-/)
})

test('validate on the broken fixture exits 0 and lists every problem', () => {
  const root = makeRepo('broken')
  const result = json(root, ['validate'])
  assert.ok(result.problems.length > 1)
  const text = run(root, ['validate'])
  assert.equal(text.status, 0)
  for (const problem of result.problems) {
    assert.ok(text.stdout.includes(problem.path), problem.path)
    assert.ok(text.stdout.includes(problem.code), problem.code)
    assert.ok(text.stdout.includes(problem.message), problem.message)
  }
})

test('validate exits 0 and prints a .pmkit/config.yaml problem as path, code and message', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/system: none/, 'system: gitlab'))
  const text = run(root, ['validate'])
  assert.equal(text.status, 0)
  assert.match(text.stdout, /^\.pmkit\/config\.yaml {2}config {2}git_host\.system must be github or none$/m)
  const problem = json(root, ['validate']).problems.find((p) => p.path === '.pmkit/config.yaml')
  assert.equal(problem.code, 'config')
})

const LINEAR_LINE = /^\.pmkit\/config\.yaml {2}config {2}tracker\.system "linear" is not supported yet, set it to local$/m
const useLinear = (root) => {
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/system: local/, 'system: linear'))
  return file
}

test('validate lists tracker.system linear as a problem and exits 0', () => {
  const root = makeRepo('basic')
  useLinear(root)
  const text = run(root, ['validate'])
  assert.equal(text.status, 0)
  assert.equal(text.stdout.split('\n')[0], 'checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 releases, 0 comments')
  assert.match(text.stdout, LINEAR_LINE)
  const problem = json(root, ['validate']).problems[0]
  assert.deepEqual(Object.keys(problem).sort(), ['code', 'message', 'path'])
  assert.deepEqual(problem, { path: '.pmkit/config.yaml', code: 'config', message: 'tracker.system "linear" is not supported yet, set it to local' })
})

test('validate with linear and a bad git_host lists both and exits 0', () => {
  const root = makeRepo('basic')
  const file = useLinear(root)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/system: none/, 'system: gitlab'))
  const text = run(root, ['validate'])
  assert.equal(text.status, 0)
  assert.match(text.stdout, LINEAR_LINE)
  assert.match(text.stdout, /^\.pmkit\/config\.yaml {2}config {2}git_host\.system must be github or none$/m)
})

test('issues list with linear still exits 2 with NOT_SUPPORTED', () => {
  const root = makeRepo('basic')
  useLinear(root)
  const result = run(root, ['issues', 'list', '--json'])
  assert.equal(result.status, 2)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_SUPPORTED')
  assert.equal(error.message, 'tracker.system "linear" is not supported yet')
})

test('validate text starts with the counts, milestones included', () => {
  const root = makeRepo('basic')
  const dir = path.join(root, '.issues', 'milestones')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'v1.md'), '---\nname: V1\n---\n')
  const { checked } = json(root, ['validate'])
  const text = run(root, ['validate'])
  assert.equal(text.status, 0)
  assert.equal(text.stdout.split('\n')[0], `checked: ${checked.issues} issues, ${checked.epics} epics, ${checked.sprints} sprints, 1 milestones, ${checked.releases} releases, ${checked.comments} comments`)
})

test('capabilities --json lists 20 capabilities', () => {
  const root = makeRepo('basic')
  assert.equal(json(root, ['capabilities']).capabilities.length, 20)
  assert.match(run(root, ['capabilities']).stdout, /cycles/)
})

test('discover and whoami', () => {
  const root = makeRepo('team')
  assert.ok(json(root, ['discover']).statuses.length >= 7)
  assert.match(run(root, ['discover']).stdout, /in_progress/)
  assert.deepEqual(json(root, ['whoami']).id, 'fred')
  const none = run(root, ['whoami'], { env: { PMKIT_USER: null } })
  assert.equal(none.status, 2)
  assert.match(none.stderr, /^next: /m)
})

test('--help lists every command and exits 2', () => {
  const result = run(os.tmpdir(), ['--help'])
  assert.equal(result.status, 2)
  for (const name of [
    'init', 'capabilities', 'discover', 'whoami', 'issues list', 'issues get', 'issues dependencies', 'issues create', 'issues update', 'issues move',
    'issues assign', 'issues link', 'issues parent', 'issues comment', 'issues log-time', 'issues archive',
    'cycle list', 'cycle current', 'cycle issues', 'cycle open', 'cycle close', 'cycle add', 'cycle capacity',
    'epic list', 'epic get', 'epic progress', 'epic create', 'epic update-status', 'release-notes',
    'metrics velocity', 'metrics cycle-time', 'metrics lead-time', 'metrics throughput', 'metrics aging', 'events', 'validate',
  ]) assert.ok(result.stdout.includes(name), name)
})

test('an unknown command prints usage and exits 2', () => {
  const result = run(os.tmpdir(), ['frobnicate'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Usage:/)
})

test('an unknown flag is a usage error', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'list', '--sortt', 'priority', '--json'])
  assert.equal(result.status, 2)
  assert.match(JSON.parse(result.stdout).error.message, /--sortt/)
  assert.equal(run(root, ['issues', 'list', '--dry-run']).status, 2)
})

test('criteria come from a file, --check ticks one and --uncheck clears it', () => {
  const root = makeRepo('basic')
  const created = JSON.parse(run(root, ['issues', 'create', '--title', 'C', '--criteria-file', '-', '--json'], { input: '- [ ] first\nsecond\n\n- [x] third\n' }).stdout)
  const id = created.after.id
  assert.deepEqual(created.after.acceptanceCriteria, [
    { text: 'first', done: false }, { text: 'second', done: false }, { text: 'third', done: true },
  ])
  const ticked = json(root, ['issues', 'update', id, '--check', '2'])
  assert.deepEqual(ticked.after.acceptanceCriteria.map((c) => c.done), [false, true, true])
  const cleared = json(root, ['issues', 'update', id, '--uncheck', '3'])
  assert.deepEqual(cleared.after.acceptanceCriteria.map((c) => c.done), [false, true, false])
  const bad = run(root, ['issues', 'update', id, '--check', '9'])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /^error: /m)
})

test('description file, estimate and labels reach the issue', () => {
  const root = makeRepo('team')
  const dir = tempDir('pmkit-body-')
  const file = path.join(dir, 'd.md')
  fs.writeFileSync(file, 'Line one\r\n\r\nLine two\r\n')
  const { after } = json(root, ['issues', 'create', '--title', 'T', '--estimate', '5', '--label', 'backend,billing', '--description-file', file, '--type', 'bug'])
  assert.equal(after.estimate, 5)
  assert.deepEqual(after.labels, ['backend', 'billing'])
  assert.equal(after.description, 'Line one\n\nLine two')
  const got = run(root, ['issues', 'get', after.id])
  assert.match(got.stdout, /estimate: 5/)
  assert.match(got.stdout, /Line two/)
})

test('assign, link, comment, log-time, archive and get --comments --history', () => {
  const root = makeRepo('team')
  assert.match(run(root, ['issues', 'assign', 'ISS-3F7H', 'ana']).stdout, /assignee: .* → ana/)
  json(root, ['issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'blocks'])
  assert.deepEqual(json(root, ['issues', 'get', 'ISS-4M2S']).blockedBy, ['ISS-3F7H'])
  json(root, ['issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'blocks', '--remove'])
  assert.deepEqual(json(root, ['issues', 'get', 'ISS-4M2S']).blockedBy, [])
  const dir = tempDir('pmkit-body-')
  const file = path.join(dir, 'c.md')
  fs.writeFileSync(file, 'Looks good.')
  assert.equal(run(root, ['issues', 'comment', 'ISS-3F7H', '--body-file', file]).status, 0)
  assert.equal(run(root, ['issues', 'log-time', 'ISS-3F7H', '45']).status, 0)
  assert.equal(run(root, ['issues', 'archive', 'ISS-3F7H']).status, 0)
  const got = json(root, ['issues', 'get', 'ISS-3F7H', '--comments', '--history'])
  assert.equal(got.comments.at(-1).body, 'Looks good.')
  assert.ok(got.history.some((event) => event.op === 'log_time' && event.minutes === 45))
  assert.equal(got.archived, true)
  const text = run(root, ['issues', 'get', 'ISS-3F7H', '--comments', '--history']).stdout
  assert.match(text, /Looks good\./)
  assert.match(text, /log_time/)
})

test('--as acts for another member and a stranger is rejected', () => {
  const root = makeRepo('team')
  json(root, ['issues', 'move', 'ISS-3F7H', 'done', '--as', 'ana'])
  const events = json(root, ['issues', 'get', 'ISS-3F7H', '--history']).history
  assert.equal(events.at(-1).by, 'ana')
  assert.equal(run(root, ['issues', 'move', 'ISS-3F7H', 'todo', '--as', 'nobody']).status, 2)
})

test('cycle capacity reads, and --set takes a list or repeated flags', () => {
  const root = makeRepo('team')
  assert.deepEqual(json(root, ['cycle', 'capacity', '2026-10-12']), { capacity: { fred: 8, ana: 10 }, days_off: { ana: ['2026-10-16'] } })
  assert.deepEqual(json(root, ['cycle', 'capacity', '2026-10-12', '--set', 'fred=3,ana=4']).after.capacity, { fred: 3, ana: 4 })
  assert.deepEqual(json(root, ['cycle', 'capacity', '2026-10-12', '--set', 'fred=6', '--set', 'ana=7']).after.capacity, { fred: 6, ana: 7 })
  assert.equal(run(root, ['cycle', 'capacity', '2026-10-12', '--set', 'fred']).status, 2)
})

test('cycle capacity --days-off sets, clears and validates', () => {
  const root = makeRepo('team')
  const sprintFile = path.join(root, '.issues/sprints/2026-10-12.yaml')
  const cap = (...args) => json(root, ['cycle', 'capacity', '2026-10-12', ...args])
  const set = cap('--days-off', 'fred=2026-10-14+2026-10-13')
  assert.deepEqual(set.after.daysOff.fred, ['2026-10-13', '2026-10-14'])
  assert.deepEqual(set.after.daysOff.ana, ['2026-10-16'])
  const both = cap('--days-off', 'fred=2026-10-14', '--days-off', 'ana=2026-10-19')
  assert.deepEqual(both.after.daysOff, { fred: ['2026-10-14'], ana: ['2026-10-19'] })
  assert.equal('ana' in cap('--days-off', 'ana=none').after.daysOff, false)
  const combined = cap('--set', 'fred=3', '--days-off', 'fred=2026-10-15')
  assert.equal(combined.after.capacity.fred, 3)
  assert.deepEqual(combined.after.daysOff.fred, ['2026-10-15'])
  const before = fs.readFileSync(sprintFile, 'utf8')
  cap('--days-off', 'fred=2026-10-16', '--dry-run')
  assert.equal(fs.readFileSync(sprintFile, 'utf8'), before)
  cap('--days-off', 'ana=2026-10-16')
  const text = run(root, ['cycle', 'capacity', '2026-10-12'])
  assert.match(text.stdout, /days off/)
  assert.match(text.stdout, /ana/)
  for (const bad of ['fred', '=2026-10-14', 'fred=']) assert.equal(run(root, ['cycle', 'capacity', '2026-10-12', '--days-off', bad]).status, 2, bad)
  for (const bad of ['fred=2026-10-17', 'nobody=2026-10-14']) {
    const result = run(root, ['cycle', 'capacity', '2026-10-12', '--days-off', bad, '--json'])
    assert.equal(result.status, 2, bad)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
  assert.equal(fs.readFileSync(sprintFile, 'utf8').includes('2026-10-17'), false)
})

test('cycle capacity --days-off rejects a member named twice', () => {
  const root = makeRepo('team')
  const sprintFile = path.join(root, '.issues/sprints/2026-10-12.yaml')
  const before = fs.readFileSync(sprintFile, 'utf8')
  for (const args of [['--days-off', 'fred=2026-10-14', '--days-off', 'fred=2026-10-15'], ['--days-off', 'fred=2026-10-14,fred=2026-10-15']]) {
    const result = run(root, ['cycle', 'capacity', '2026-10-12', ...args, '--json'])
    assert.equal(result.status, 2)
    const error = JSON.parse(result.stdout).error
    assert.match(error.message, /--days-off names fred twice/)
    assert.match(error.next ?? error.next_step ?? JSON.stringify(error), /fred=2026-10-14\+2026-10-15/)
  }
  assert.equal(fs.readFileSync(sprintFile, 'utf8'), before)
})

test('cycle capacity reads a hand-edited days_off that is not a map of lists', () => {
  const root = makeRepo('team')
  const sprintFile = path.join(root, '.issues/sprints/2026-10-12.yaml')
  const text = fs.readFileSync(sprintFile, 'utf8').replace(/days_off:[\s\S]*$/, 'days_off:\n  ana: 2026-10-16\n  fred:\n')
  fs.writeFileSync(sprintFile, text)
  const result = run(root, ['cycle', 'capacity', '2026-10-12'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /days off ana: 2026-10-16/)
})

test('cycle capacity --days-off keeps unknown keys of the sprint file', () => {
  const root = makeRepo('team')
  const sprintFile = path.join(root, '.issues/sprints/2026-10-12.yaml')
  fs.appendFileSync(sprintFile, 'custom_note: keep me\n')
  json(root, ['cycle', 'capacity', '2026-10-12', '--days-off', 'fred=2026-10-14'])
  assert.match(fs.readFileSync(sprintFile, 'utf8'), /custom_note: keep me/)
})

test('cycle close prints the unfinished issues', () => {
  const root = makeRepo('team')
  const result = json(root, ['cycle', 'close', '2026-10-12'])
  assert.equal(result.sprint.state, 'closed')
  assert.ok(Array.isArray(result.unfinished))
  assert.match(run(makeRepo('team'), ['cycle', 'close', '2026-10-12']).stdout, /state: active → closed/)
})

// A regression guard for PMK-113 and PMK-123, not a failing-first test: it calls the CLI directly, and every call it
// makes existed before the changes to commands/cycle/close.md and commands/cycle/plan.md, so it passes before and
// after them. It guards the data the split leaves for plan.
test('a split in cycle close leaves the remaining work for cycle plan', () => {
  const root = makeRepo('team')
  // The setup of the cycle-close scenario: ISS-2X6D gets one checked and one unchecked criterion.
  json(root, ['issues', 'update', 'ISS-2X6D', '--criteria-file', '-'], { input: '- [x] Export invoices for a date range\n- [ ] Totals row at the bottom\n' })
  // The step 8 writes of the cycle-close scenario: create with the unchecked criterion, related link, blocker link,
  // sub-issue move, lower the estimate, move to done, then close.
  const { after: remaining } = json(root, ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--criteria-file', '-'], { input: '- [ ] Totals row at the bottom\n' })
  json(root, ['issues', 'link', remaining.id, 'ISS-2X6D', '--kind', 'related'])
  json(root, ['issues', 'link', 'ISS-5N1R', remaining.id, '--kind', 'blocks'])
  json(root, ['issues', 'parent', 'ISS-4M2S', remaining.id])
  json(root, ['issues', 'update', 'ISS-2X6D', '--estimate', '5'])
  json(root, ['issues', 'move', 'ISS-2X6D', 'done'])
  json(root, ['cycle', 'close', '2026-10-12'])
  // The query of commands/cycle/plan.md step 5.
  const list = json(root, ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']).issues
  const offered = list.map((issue) => issue.id)
  assert.ok(offered.includes(remaining.id), 'plan offers the remaining work')
  assert.ok(!offered.includes('ISS-2X6D'), 'plan does not offer the delivered original')
  const carried = list.find((issue) => issue.id === remaining.id)
  assert.deepEqual(carried.blockedBy, ['ISS-5N1R'], 'the new issue carries the open blocker')
  assert.deepEqual(carried.children, ['ISS-4M2S'], 'the new issue carries the open sub-issue')
  // The second query of commands/cycle/plan.md step 5.
  const blocked = json(root, ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none', '--blocked']).issues
  assert.deepEqual(blocked.map((issue) => issue.id), [remaining.id])
  assert.deepEqual(json(root, ['issues', 'get', remaining.id]).acceptanceCriteria, [{ text: 'Totals row at the bottom', done: false }])
  const inSprint = json(root, ['cycle', 'issues', '2026-10-12'])
  assert.equal(inSprint.find((issue) => issue.id === 'ISS-2X6D').status.category, 'done')
  // ISS-2X6D is the only done issue of the sprint: the test runs no pr sync, so ISS-8C4W stays in in_review.
  // Every call runs at PMKIT_NOW 2026-10-23, before the sprint's end. "velocity counts the moves to done made before a late close and not after it" covers a late close.
  const velocity = json(root, ['metrics', 'velocity'])
  assert.deepEqual(velocity.perSprint.find((sprint) => sprint.id === '2026-10-12'), { id: '2026-10-12', points: 5, count: 1 })
})

test('velocity counts the moves to done made before a late close and not after it', () => {
  const root = makeRepo('team')
  const at = (iso) => ({ env: { PMKIT_NOW: iso } })
  json(root, ['issues', 'move', 'ISS-5N1R', 'done'], at('2026-10-24T15:00:00Z'))
  // The write pr sync makes when the pull request merges, after the sprint's end.
  json(root, ['issues', 'move', 'ISS-8C4W', 'done'], at('2026-10-26T10:00:00Z'))
  const split = at('2026-10-26T11:00:00Z')
  const { after: remaining } = json(root, ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend'], split)
  json(root, ['issues', 'link', remaining.id, 'ISS-2X6D', '--kind', 'related'], split)
  json(root, ['issues', 'update', 'ISS-2X6D', '--estimate', '5'], split)
  json(root, ['issues', 'move', 'ISS-2X6D', 'done'], split)
  const closed = json(root, ['cycle', 'close', '2026-10-12'], at('2026-10-26T12:00:00Z'))
  assert.equal(closed.sprint.closed, '2026-10-26T12:00:00Z')
  assert.deepEqual(closed.unfinished.map((issue) => issue.id), ['ISS-4M2S'])
  assert.match(fs.readFileSync(path.join(root, '.issues/sprints/2026-10-12.yaml'), 'utf8'), /^state: closed\nclosed: 2026-10-26T12:00:00Z$/m)
  const done = json(root, ['cycle', 'issues', '2026-10-12']).filter((issue) => issue.status.category === 'done')
  assert.deepEqual(done.map((issue) => issue.id).sort(), ['ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W'])
  const points = done.reduce((sum, issue) => sum + issue.estimate, 0)
  assert.equal(points, 13)
  const rows = [{ id: '2026-09-28', points: 10, count: 3 }, { id: '2026-10-12', points: 13, count: 3 }]
  const velocity = json(root, ['metrics', 'velocity'])
  assert.deepEqual(velocity.perSprint, rows)
  assert.deepEqual(velocity.perSprint.find((sprint) => sprint.id === '2026-10-12'), { id: '2026-10-12', points, count: done.length })
  json(root, ['issues', 'move', 'ISS-4M2S', 'done'], at('2026-10-27T10:00:00Z'))
  assert.deepEqual(json(root, ['metrics', 'velocity']).perSprint, rows)
})

test('auto_commit commits only the tracker folder with pmkit: <op> <id>', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(root, 'other.txt'), 'x')
  git(root, 'add', 'other.txt')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), `pmkit: issues create ${after.id}`)
  assert.ok(git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.includes(`.issues/issues/${after.id}/issue.md`))
  assert.ok(!git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.includes('other.txt'))
  assert.equal(git(root, 'status', '--porcelain').stdout.trim(), 'A  other.txt')
  const dry = run(root, ['issues', 'move', after.id, 'todo', '--dry-run'])
  assert.equal(dry.status, 0)
  assert.equal(git(root, 'rev-list', '--count', 'HEAD').stdout.trim(), '2')
})

test('a failing auto_commit exits 2 with one JSON value that carries the result', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  const hook = path.join(root, '.git/hooks/pre-commit')
  fs.writeFileSync(hook, '#!/bin/sh\necho rejected >&2\nexit 1\n', { mode: 0o755 })
  const result = run(root, ['issues', 'create', '--title', 'First', '--json'])
  assert.equal(result.status, 2)
  const body = JSON.parse(result.stdout)
  assert.equal(body.error.code, 'UPSTREAM')
  assert.ok(body.error.nextStep)
  assert.equal(body.result.after.title, 'First')
  assert.ok(fs.existsSync(path.join(root, '.issues/issues', body.result.after.id, 'issue.md')))
  const text = run(root, ['issues', 'create', '--title', 'Second'])
  assert.equal(text.status, 2)
  assert.match(text.stdout, /Second/)
  assert.match(text.stderr, /^error: .*auto_commit failed/m)
  assert.match(text.stderr, /^next: /m)
})

test('every next step that starts with pmkit names a real CLI command', async () => {
  const { COMMANDS } = await import('./pmkit.mjs')
  const names = new Set(COMMANDS.map((command) => command.name))
  const dir = path.dirname(CLI)
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name)
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.mjs') ? [full] : []
  })
  const sources = [CLI, ...walk(path.join(dir, 'lib'))]
  // Every string literal is a superset of the next steps; only those starting with `pmkit ` are checked.
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  const bad = []
  let checked = 0
  for (const file of sources) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(literal)) {
      const text = match[1] ?? match[2] ?? match[3]
      if (!text.startsWith('pmkit ')) continue
      checked++
      const words = text.slice('pmkit '.length).split(/\s+/)
      if (!names.has(words.slice(0, 2).join(' ')) && !names.has(words[0])) bad.push(`${path.relative(dir, file)}: ${text}`)
    }
  }
  assert.ok(checked > 10, `found ${checked} next steps`)
  assert.deepEqual(bad, [])
})

test('a boolean flag takes =true or =false and nothing else', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  const before = hashTree(root)
  const dry = run(root, ['issues', 'update', after.id, '--priority', 'high', '--dry-run=true'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /dry run/)
  assert.equal(hashTree(root), before)
  const asJson = run(root, ['issues', 'get', after.id, '--json=true'])
  assert.equal(asJson.status, 0, asJson.stderr)
  assert.equal(JSON.parse(asJson.stdout).id, after.id)
  const plain = run(root, ['issues', 'get', after.id, '--json=false'])
  assert.match(plain.stdout, /^id: /m)
  const real = run(root, ['issues', 'update', after.id, '--priority', 'high', '--dry-run=false'])
  assert.equal(real.status, 0, real.stderr)
  assert.equal(json(root, ['issues', 'get', after.id]).priority, 'high')
  const bad = run(root, ['issues', 'update', after.id, '--priority', 'low', '--dry-run=yes', '--json'])
  assert.equal(bad.status, 2)
  assert.match(JSON.parse(bad.stdout).error.message, /--dry-run/)
  assert.equal(json(root, ['issues', 'get', after.id]).priority, 'high')
  const badText = run(root, ['issues', 'list', '--json=1'])
  assert.equal(badText.status, 2)
  assert.match(badText.stderr, /^error: .*--json/m)
})

test('with --json an unknown or missing command prints one JSON error', () => {
  for (const args of [['frobnicate', '--json'], ['--json']]) {
    const result = run(os.tmpdir(), args)
    assert.equal(result.status, 2)
    const { error } = JSON.parse(result.stdout)
    assert.equal(error.code, 'INVALID_INPUT')
    assert.ok(error.nextStep)
    assert.equal(result.stderr, '')
  }
})

test('issues list keeps every repeated --label', () => {
  const root = makeRepo('basic')
  const both = json(root, ['issues', 'create', '--title', 'Both', '--label', 'x,y']).after.id
  json(root, ['issues', 'create', '--title', 'Only y', '--label', 'y'])
  assert.deepEqual(json(root, ['issues', 'list', '--label', 'x', '--label', 'y']).issues.map((issue) => issue.id), [both])
})

test('a line break in a title or a sprint goal exits 2 and writes nothing', () => {
  const root = makeRepo('basic')
  const before = hashTree(root)
  const title = run(root, ['issues', 'create', '--title', 'a\nb', '--json'])
  assert.equal(title.status, 2)
  assert.equal(JSON.parse(title.stdout).error.code, 'INVALID_INPUT')
  const goal = run(root, ['cycle', 'open', '--start', '2026-10-19', '--goal', 'a\nb', '--json'])
  assert.equal(goal.status, 2)
  assert.equal(JSON.parse(goal.stdout).error.code, 'INVALID_INPUT')
  assert.equal(hashTree(root), before)
  assert.deepEqual(json(root, ['cycle', 'list']), [])
})

test('a description with a fenced example of conflict markers is written and read back', () => {
  const root = makeRepo('basic')
  const description = 'Resolve it like this:\n\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n```\n'
  const created = run(root, ['issues', 'create', '--title', 'Fenced', '--description-file', '-', '--json'], { input: description })
  assert.equal(created.status, 0, created.stdout)
  const { id } = JSON.parse(created.stdout).after
  assert.equal(json(root, ['issues', 'get', id]).description, description.trim())
  assert.deepEqual(json(root, ['validate']).problems, [])
})

test('issues list with a misspelled filter value exits 2 instead of printing no issues', () => {
  const root = makeRepo('team')
  for (const args of [['--category', 'finished'], ['--type', 'bugg'], ['--assignee', 'nobody'], ['--sprint', '2026-01-01'], ['--sort', 'size']]) {
    const result = run(root, ['issues', 'list', ...args, '--json'])
    assert.equal(result.status, 2, args.join(' '))
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
})

test('cycle close prints the unreadable issues as warnings', () => {
  const result = run(makeRepo('team'), ['cycle', 'close', '2026-10-12'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^warning: ISS-3Q6T: CONFLICT /m)
})

test('issues assign <id> me assigns the actor and cycle add --to current uses the active sprint', () => {
  const root = makeRepo('team')
  assert.equal(json(root, ['issues', 'assign', 'ISS-3F7H', 'me']).after.assignee, 'fred')
  assert.equal(json(root, ['issues', 'assign', 'ISS-3F7H', 'me', '--as', 'ana']).after.assignee, 'ana')
  assert.equal(json(root, ['cycle', 'add', 'ISS-3F7H', '--to', 'current'])[0].after.sprint, '2026-10-12')
  const empty = makeRepo('basic')
  const { after } = json(empty, ['issues', 'create', '--title', 'First'])
  const none = run(empty, ['cycle', 'add', after.id, '--to', 'current', '--json'])
  assert.equal(none.status, 2)
  const { error } = JSON.parse(none.stdout)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.message, 'there is no active sprint')
  assert.equal(error.nextStep, 'pmkit cycle list')
})

test('issues create and update resolve --sprint current to the active sprint id', () => {
  const root = makeRepo('team')
  const created = run(root, ['issues', 'create', '--title', 'T', '--sprint', 'current', '--json'])
  assert.equal(created.status, 0, created.stderr)
  assert.equal(JSON.parse(created.stdout).after.sprint, '2026-10-12')
  const updated = run(root, ['issues', 'update', 'ISS-3F7H', '--sprint', 'current', '--json'])
  assert.equal(updated.status, 0, updated.stderr)
  assert.equal(JSON.parse(updated.stdout).after.sprint, '2026-10-12')
})

test('issues create and update --sprint current fail with INVALID_INPUT when no sprint is active', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  for (const args of [['issues', 'create', '--title', 'T', '--sprint', 'current'], ['issues', 'update', after.id, '--sprint', 'current']]) {
    const result = run(root, [...args, '--json'])
    assert.equal(result.status, 2, args.join(' '))
    const { error } = JSON.parse(result.stdout)
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.message, 'there is no active sprint')
    assert.equal(error.nextStep, 'pmkit cycle list')
  }
})

test('issues update --sprint takes an explicit id and none clears it', () => {
  const root = makeRepo('team')
  assert.equal(json(root, ['issues', 'update', 'ISS-3F7H', '--sprint', '2026-10-12']).after.sprint, '2026-10-12')
  assert.equal(json(root, ['issues', 'update', 'ISS-3F7H', '--sprint', 'none']).after.sprint, undefined)
})

test('issues create takes --milestone', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'T', '--milestone', 'M1'])
  assert.equal(after.milestone, 'M1')
})

test('once a milestone file exists, --milestone must name one and --milestone none clears unchecked', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'T', '--milestone', 'jira'])
  const dir = path.join(root, '.issues', 'milestones')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'v1.md'), '---\nname: V1\n---\n')
  const missing = run(root, ['issues', 'update', after.id, '--milestone', 'v2', '--json'])
  assert.equal(missing.status, 2)
  assert.deepEqual(JSON.parse(missing.stdout).error, { code: 'INVALID_INPUT', message: 'milestone v2 does not exist', nextStep: 'pmkit milestone create v2' })
  assert.equal(json(root, ['issues', 'update', after.id, '--milestone', 'none']).after.milestone, undefined)
})

test('epic updates lists the status updates newest first', () => {
  const root = makeRepo('team')
  assert.deepEqual(json(root, ['epic', 'updates', 'EPC-2M9D']), [])
  run(root, ['epic', 'update-status', 'EPC-2M9D', '--health', 'at_risk', '--body-file', '-'], { input: 'Older.\n', env: { PMKIT_NOW: '2026-10-20T09:00:00Z' } })
  run(root, ['epic', 'update-status', 'EPC-2M9D', '--health', 'on_track', '--body-file', '-'], { input: 'Newer.\n', env: { PMKIT_NOW: '2026-10-22T09:00:00Z' } })
  const updates = json(root, ['epic', 'updates', 'EPC-2M9D'])
  assert.deepEqual(updates.map((u) => u.body), ['Newer.', 'Older.'])
  assert.match(run(root, ['epic', 'updates', 'EPC-2M9D']).stdout, /on_track/)
})

test('docs create reads the body from stdin and docs read returns it', () => {
  const root = makeRepo('basic')
  const created = json(root, ['docs', 'create', 'retros/2026-11-15.md', '--body-file', '-'], { input: '# Retro\n\nWent well.\n' })
  assert.equal(created.after.path, 'retros/2026-11-15.md')
  const read = json(root, ['docs', 'read', 'retros/2026-11-15.md'])
  assert.deepEqual(read, { path: 'retros/2026-11-15.md', body: '# Retro\n\nWent well.\n' })
  assert.match(run(root, ['docs', 'read', 'retros/2026-11-15.md']).stdout, /Went well/)
})

test('docs create --dry-run writes nothing', () => {
  const root = makeRepo('basic')
  const before = hashTree(root)
  const result = run(root, ['docs', 'create', 'retros/x.md', '--body-file', '-', '--dry-run'], { input: 'Body.\n' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /dry run/)
  assert.equal(hashTree(root), before)
})

test('docs read refuses a path outside the docs folder', () => {
  const root = makeRepo('basic')
  const result = run(root, ['docs', 'read', '../x.md', '--json'])
  assert.equal(result.status, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

function fixConfig(root) {
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/stale_days:.*/, 'stale_days: 60'))
}

test('unlink removes a reference to a missing issue, and link still needs both issues', () => {
  const root = makeRepo('broken')
  fixConfig(root)
  const link = (...args) => run(root, ['issues', 'link', ...args], { env: { PMKIT_USER: 'fred' } })
  const bad = link('ISS-4REF', 'ISS-9ZZZ', '--kind', 'related')
  assert.equal(bad.status, 2)
  assert.match(bad.stdout + bad.stderr, /ISS-9ZZZ does not exist/)
  const ok = link('ISS-9ZZZ', 'ISS-4REF', '--kind', 'blocks', '--remove')
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.issues/issues/ISS-4REF/issue.md'), 'utf8'), /ISS-9ZZZ/)
})

test('unlink related and duplicate remove a missing target', () => {
  const root = makeRepo('broken')
  fixConfig(root)
  const file = path.join(root, '.issues/issues/ISS-4REF/issue.md')
  const text = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, text.replace('blocked_by: [ISS-9ZZZ]', 'blocked_by: []\nrelated: [ISS-9ZZZ]\nduplicate_of: [ISS-9ZZY]'))
  for (const [target, kind] of [['ISS-9ZZZ', 'related'], ['ISS-9ZZY', 'duplicate']]) {
    const res = run(root, ['issues', 'link', 'ISS-4REF', target, '--kind', kind, '--remove'], { env: { PMKIT_USER: 'fred' } })
    assert.equal(res.status, 0, res.stdout + res.stderr)
  }
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /ISS-9ZZ/)
})

test('unlink of a missing blocker previews the blocked_by change on the issue whose file changes', () => {
  const root = makeRepo('broken')
  fixConfig(root)
  const args = ['issues', 'link', 'ISS-9ZZZ', 'ISS-4REF', '--kind', 'blocks', '--remove']
  const dry = json(root, [...args, '--dry-run'], { env: { PMKIT_USER: 'fred' } })
  assert.equal(dry.after.id, 'ISS-4REF')
  assert.deepEqual(dry.before.blockedBy, ['ISS-9ZZZ'])
  assert.deepEqual(dry.after.blockedBy, [])
  const text = run(root, [...args, '--dry-run'], { env: { PMKIT_USER: 'fred' } }).stdout
  assert.doesNotMatch(text, /no change/)
  assert.match(text, /ISS-9ZZZ/)
})

test('milestone list prints no milestones on an empty tracker and a table after a create', () => {
  const root = makeRepo('basic')
  assert.equal(run(root, ['milestone', 'list']).stdout.trim(), 'no milestones')
  assert.deepEqual(json(root, ['milestone', 'list']), [])
  json(root, ['milestone', 'create', 'local-gaps', '--name', 'Local tracker gaps', '--due', '2026-11-30'])
  const text = run(root, ['milestone', 'list']).stdout
  assert.match(text, /ID\s+\| Name\s+\| Due/)
  assert.match(text, /local-gaps\s+\| Local tracker gaps\s+\| 2026-11-30/)
  assert.deepEqual(json(root, ['milestone', 'list']).map((m) => m.id), ['local-gaps'])
})

test('milestone get prints the record and a miss is NOT_FOUND', () => {
  const root = makeRepo('basic')
  const dir = path.join(root, '.issues', 'milestones')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'v1.md'), '---\nname: Version one\ndue: 2026-12-01\n---\nShip it.\n')
  const text = run(root, ['milestone', 'get', 'v1']).stdout
  assert.match(text, /^id: v1$/m)
  assert.match(text, /^name: Version one$/m)
  assert.match(text, /^due: 2026-12-01$/m)
  assert.match(text, /Ship it\./)
  const miss = run(root, ['milestone', 'get', 'nope', '--json'])
  assert.equal(miss.status, 2)
  assert.deepEqual(JSON.parse(miss.stdout).error, { code: 'NOT_FOUND', message: 'milestone nope does not exist', nextStep: 'pmkit milestone list' })
})

test('milestone create returns before and after, and --dry-run writes nothing', () => {
  const root = makeRepo('basic')
  const before = hashTree(path.join(root, '.issues'))
  const dry = json(root, ['milestone', 'create', 'local-gaps', '--dry-run'])
  assert.equal(dry.before, null)
  assert.equal(dry.after.id, 'local-gaps')
  assert.deepEqual(hashTree(path.join(root, '.issues')), before)
  const made = json(root, ['milestone', 'create', 'local-gaps', '--name', 'Local tracker gaps', '--due', '2026-11-30'])
  assert.equal(made.before, null)
  assert.deepEqual([made.after.name, made.after.due], ['Local tracker gaps', '2026-11-30'])
  assert.ok(fs.existsSync(path.join(root, '.issues/milestones/local-gaps.md')))
})

test('milestone create refuses a bad id with INVALID_INPUT and writes nothing', () => {
  const root = makeRepo('basic')
  const result = run(root, ['milestone', 'create', 'Q4 2026', '--json'])
  assert.equal(result.status, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  assert.ok(!fs.existsSync(path.join(root, '.issues/milestones')))
})

test('milestone create commits as pmkit: milestone create <id> when auto commit is on', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  json(root, ['milestone', 'create', 'local-gaps'])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), 'pmkit: milestone create local-gaps')
})

test('milestone create warns on stderr about milestone names that have no file', () => {
  const root = makeRepo('basic')
  json(root, ['issues', 'create', '--title', 'A', '--milestone', 'jira'])
  json(root, ['issues', 'create', '--title', 'B', '--milestone', 'jira'])
  json(root, ['issues', 'create', '--title', 'C', '--milestone', 'generic-commands'])
  const { after: epic } = json(root, ['epic', 'create', '--title', 'E'])
  const epicFile = path.join(root, '.issues/epics', epic.id, 'epic.md')
  fs.writeFileSync(epicFile, fs.readFileSync(epicFile, 'utf8').replace(/^---\n/, '---\nmilestone: generic-commands\n'))
  const result = run(root, ['milestone', 'create', 'x', '--json'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^warning: 2 milestones named by issues or epics have no file: generic-commands \(2\), jira \(2\); run \/pmkit:local:doctor$/m)
  const body = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(body), ['before', 'after'])
  const dry = run(root, ['milestone', 'create', 'jira', '--dry-run'])
  assert.match(dry.stderr, /warning: 1 milestone named by issues or epics has no file: generic-commands \(2\); run/)
  assert.doesNotMatch(dry.stderr, /1 milestones/)
})

test('milestone create warning counts a milestone that only an archived issue names', () => {
  const root = makeRepo('basic')
  const { after: issue } = json(root, ['issues', 'create', '--title', 'A', '--milestone', 'old'])
  assert.equal(run(root, ['issues', 'archive', issue.id]).status, 0)
  const result = run(root, ['milestone', 'create', 'x'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /warning: 1 milestone named by issues or epics has no file: old \(1\); run/)
})

test('milestone create gives no warning when every name has a file', () => {
  const root = makeRepo('basic')
  json(root, ['issues', 'create', '--title', 'A', '--milestone', 'jira'])
  json(root, ['milestone', 'create', 'jira'])
  const result = run(root, ['milestone', 'create', 'y'])
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /warning/)
})

const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0
const cacheIn = (root) => path.join(root, '.issues', '.cache')

test('reindex --json rebuilds the index and leaves issues list unchanged', () => {
  const root = makeRepo('team')
  try {
    const before = run(root, ['issues', 'list', '--archived', '--json']).stdout
    fs.mkdirSync(cacheIn(root), { recursive: true })
    fs.writeFileSync(path.join(cacheIn(root), 'index.json.tmp-999-0'), 'partial')
    assert.deepEqual(json(root, ['reindex']), { written: true, path: '.issues/.cache/index.json', issues: 12, problems: 1 })
    assert.deepEqual(fs.readdirSync(cacheIn(root)).sort(), ['.gitignore', 'index.json'])
    assert.equal(run(root, ['issues', 'list', '--archived', '--json']).stdout, before)
    const text = run(root, ['reindex'])
    assert.equal(text.status, 0)
    assert.equal(text.stdout, 'indexed 12 issues (1 could not be read) in .issues/.cache/index.json\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reindex on a read-only tracker exits 0 with written: false', { skip: !canChmod }, () => {
  const root = makeRepo('team')
  const dir = path.join(root, '.issues')
  fs.chmodSync(dir, 0o555)
  try {
    const body = json(root, ['reindex'])
    assert.equal(body.written, false)
    assert.equal(typeof body.reason, 'string')
    const text = run(root, ['reindex'])
    assert.equal(text.status, 0)
    assert.match(text.stdout, /^the query index was not written: /)
    assert.match(text.stderr, /^warning: searches still work, they read every issue file$/m)
  } finally {
    fs.chmodSync(dir, 0o755)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('issues list writes the index and CLI dry runs never touch it', () => {
  const root = makeRepo('team')
  try {
    const dryRuns = () => {
      for (const args of [['issues', 'link', 'ISS-0G5E', 'ISS-1V9Z', '--kind', 'blocks', '--dry-run'], ['cycle', 'close', '2026-10-12', '--dry-run']]) {
        assert.equal(run(root, [...args, '--json']).status, 0, args.join(' '))
      }
    }
    dryRuns()
    assert.equal(fs.existsSync(cacheIn(root)), false)
    json(root, ['issues', 'list'])
    const file = path.join(cacheIn(root), 'index.json')
    const bytes = fs.readFileSync(file)
    dryRuns()
    assert.deepEqual(fs.readFileSync(file), bytes)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the index never reaches git status or an auto-commit', () => {
  const root = makeRepo('team')
  try {
    assert.equal(fs.existsSync(path.join(root, '.issues', '.gitignore')), false)
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@x.dev')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'fixture')
    json(root, ['issues', 'list'])
    assert.ok(fs.existsSync(path.join(cacheIn(root), 'index.json')))
    assert.equal(git(root, 'status', '--porcelain').stdout, '')
    const config = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
    git(root, 'commit', '-q', '-am', 'auto commit on')
    // A blocks link reads through the index in the middle of the write, so the write refreshes the cache.
    fs.rmSync(cacheIn(root), { recursive: true, force: true })
    json(root, ['issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'blocks'])
    assert.ok(fs.existsSync(path.join(cacheIn(root), 'index.json')))
    const committed = git(root, 'show', '--name-only', '--format=', 'HEAD').stdout
    assert.match(committed, /issue\.md/)
    assert.doesNotMatch(committed, /\.cache/)
    assert.equal(git(root, 'status', '--porcelain').stdout, '')
    assert.equal(git(root, 'ls-files', '.issues/.cache').stdout, '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reindex on an older tracker format exits 0 with written: false and creates no .cache', () => {
  const root = makeRepo('team')
  try {
    const config = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/^version: \d+$/m, 'version: 1'))
    const body = json(root, ['reindex'])
    assert.equal(body.written, false)
    assert.match(body.reason, /tracker format 1; run \/pmkit:upgrade/)
    const text = run(root, ['reindex'])
    assert.equal(text.status, 0)
    assert.match(text.stdout, /^the query index was not written: /)
    assert.match(text.stderr, /^warning: searches still work, they read every issue file$/m)
    assert.equal(fs.existsSync(cacheIn(root)), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reindex is not a write: --dry-run and --as are usage errors', () => {
  const root = makeRepo('team')
  try {
    for (const flags of [['--dry-run'], ['--as', 'fred']]) {
      assert.equal(run(root, ['reindex', ...flags]).status, 2, flags.join(' '))
    }
    assert.equal(fs.existsSync(cacheIn(root)), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const NO_SPRINT_WARNING = 'warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list'

test('issues list --sprint current says there is no active sprint and still lists nothing', () => {
  const root = makeRepo('basic')
  try {
    assert.equal(run(root, ['issues', 'create', '--title', 'First']).status, 0)
    const result = run(root, ['issues', 'list', '--sprint', 'current'])
    assert.equal(result.status, 0)
    assert.equal(result.stdout, 'no issues\n')
    assert.equal(result.stderr, `${NO_SPRINT_WARNING}\n`)
    assert.equal(json(root, ['issues', 'list']).issues.length, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('issues list --sprint current --json keeps parseable stdout and puts the reason in a warning line', () => {
  const root = makeRepo('basic')
  try {
    assert.equal(run(root, ['issues', 'create', '--title', 'First']).status, 0)
    const result = run(root, ['issues', 'list', '--sprint', 'current', '--json'])
    assert.equal(result.status, 0)
    assert.deepEqual(JSON.parse(result.stdout), { issues: [], problems: [] })
    assert.equal(result.stderr, `${NO_SPRINT_WARNING}\n`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('issues list --sprint current gives no warning when a sprint is active, and none or an id never warn', () => {
  const team = makeRepo('team')
  const basic = makeRepo('basic')
  try {
    const active = run(team, ['issues', 'list', '--sprint', 'current', '--json'])
    assert.equal(active.status, 0)
    assert.deepEqual(JSON.parse(active.stdout).issues.map((i) => i.id).sort(), ['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R', 'ISS-8C4W'])
    assert.doesNotMatch(active.stderr, /no active sprint/)
    const filtered = run(team, ['issues', 'list', '--sprint', 'current', '--text', 'zzzzzz', '--json'])
    assert.equal(filtered.status, 0)
    assert.deepEqual(JSON.parse(filtered.stdout).issues, [])
    assert.doesNotMatch(filtered.stderr, /no active sprint/)

    for (const args of [['--sprint', 'none'], []]) {
      const result = run(basic, ['issues', 'list', ...args, '--json'])
      assert.equal(result.status, 0)
      assert.equal(result.stderr, '')
      assert.deepEqual(JSON.parse(result.stdout).issues, [])
    }

    assert.equal(run(basic, ['cycle', 'open', '--start', '2026-10-26']).status, 0)
    const planned = run(basic, ['issues', 'list', '--sprint', '2026-10-26', '--json'])
    assert.equal(planned.status, 0)
    assert.equal(planned.stderr, '')
    assert.deepEqual(JSON.parse(planned.stdout).issues, [])
    const current = run(basic, ['issues', 'list', '--sprint', 'current'])
    assert.equal(current.status, 0)
    assert.equal(current.stdout, 'no issues\n')
    assert.equal(current.stderr, `${NO_SPRINT_WARNING}\n`)
  } finally {
    fs.rmSync(team, { recursive: true, force: true })
    fs.rmSync(basic, { recursive: true, force: true })
  }
})

const cmd = (name) => COMMANDS.find((c) => c.name === name)

test('configClass sorts every call into exempt, read or write', () => {
  assert.deepEqual(COMMANDS.filter((c) => c.exempt).map((c) => c.name), ['init', 'changelog', 'validate'])
  for (const name of ['init', 'changelog', 'validate']) assert.equal(configClass(cmd(name), {}), 'exempt', name)
  assert.equal(configClass(cmd('issues list'), {}), 'read')
  assert.equal(configClass(cmd('issues create'), {}), 'write')
  assert.equal(configClass(cmd('migrate'), {}), 'write')
  assert.equal(configClass(cmd('cycle capacity'), {}), 'read')
  assert.equal(configClass(cmd('cycle capacity'), { set: 'fred=5' }), 'write')
  assert.equal(configClass(cmd('cycle capacity'), { 'days-off': 'fred=2026-10-20' }), 'write')
})

// A parent chain deep enough that JSON.stringify overflows the stack, while the text printer still copes.
const chainCtx = (depth, json) => {
  const status = { name: 'todo', category: 'todo' }
  const issues = Array.from({ length: depth }, (_, index) => ({
    id: `N${index}`, title: 't', status, blockedBy: [], related: [], archived: false, parent: index === 0 ? 'EPC-1' : `N${index - 1}`,
  }))
  return {
    args: ['EPC-1'],
    json,
    tracker: () => ({
      getDeliverable: () => ({ id: 'EPC-1', title: 'Epic', status }),
      searchIssues: () => ({ issues, problems: [] }),
      capabilities: () => ({ capabilities: [{ id: 'dependencies', path: 'native' }] }),
    }),
    config: () => ({ local: { epic_prefix: 'EPC', estimate: { unit: 'points' } } }),
  }
}

test('issues dependencies prints a deep chain in text mode and fails only for JSON', () => {
  const text = cmd('issues dependencies').run(chainCtx(3000, false))
  assert.ok(text.text.includes('N2999'))
  assert.throws(() => cmd('issues dependencies').run(chainCtx(3000, true)), (error) => error.code === 'INVALID_INPUT' && /too deep/.test(error.message))
})

const INPUTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '__goldens__', '_inputs')
const input = (name) => path.join(INPUTS, name)
const editPmkit = (root, from, to) => {
  const file = path.join(root, '.pmkit', 'config.yaml')
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(text.includes(from), `.pmkit/config.yaml has ${from}`)
  fs.writeFileSync(file, text.replace(from, to))
}
const MAYBE = ['confirm: single_writes', 'confirm: maybe']
const GITLAB = ['system: none', 'system: gitlab']
const CONFIRM_MSG = 'write_policy.confirm must be one of all_writes, single_writes, none'
const HOST_MSG = 'git_host.system must be github or none'
const REFUSAL = (...p) => `.pmkit/config.yaml is not valid, so writes are refused: ${p.join('; ')}`
const WARNING = (...p) => `warning: ${REFUSAL(...p)}; run pmkit validate`
const errorOf = (result) => JSON.parse(result.stdout).error

test('every write refuses an invalid .pmkit/config.yaml and writes nothing', () => {
  const WRITES = {
    'issues create': ['--title', 'Second', '--type', 'task'],
    'issues update': ['ISS-5N1R', '--title', 'Renamed'],
    'issues move': ['ISS-5N1R', 'done'],
    'issues assign': ['ISS-5N1R', 'fred'],
    'issues link': ['ISS-5N1R', 'ISS-4M2S', '--kind', 'blocks'],
    'issues parent': ['ISS-5N1R', 'EPC-2M9D'],
    'issues comment': ['ISS-5N1R', '--body-file', input('comment.md')],
    'issues log-time': ['ISS-5N1R', '30'],
    'issues archive': ['ISS-5N1R'],
    'cycle open': ['--start', '2026-10-26'],
    'cycle close': ['2026-10-12'],
    'cycle add': ['ISS-5N1R', '--to', 'current'],
    'cycle capacity': ['2026-10-12', '--set', 'fred=5'],
    'epic create': ['--title', 'New epic'],
    'epic update-status': ['EPC-2M9D', '--health', 'on_track', '--body-file', input('update.md')],
    'milestone create': ['v2.0'],
    'release create': ['2.0.0'],
    'release mark-released': ['1.0.0'],
    'docs create': ['notes/new.md', '--body-file', input('doc.md')],
    'issues branch': ['ISS-5N1R'],
    'pr open': ['--issue', 'ISS-5N1R'],
    'pr ready': ['--issue', 'ISS-5N1R'],
    'pr sync': [],
    migrate: [],
  }
  assert.deepEqual(Object.keys(WRITES).sort(), COMMANDS.filter((c) => c.write).map((c) => c.name).sort())
  const root = makeRepo('team')
  editPmkit(root, 'system: none', 'system: github\n  default_branch: main')
  editPmkit(root, ...MAYBE)
  const fake = fakeGh({})
  const env = { PATH: `${fake.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: fake.responses }
  const before = hashTree(root)
  const expected = { code: 'INVALID_INPUT', message: REFUSAL(CONFIRM_MSG), nextStep: 'pmkit validate' }
  const calls = [
    ...Object.entries(WRITES).flatMap(([name, argv]) => [[...name.split(' '), ...argv, '--json'], [...name.split(' '), ...argv, '--dry-run', '--json']]),
    ['cycle', 'capacity', '2026-10-12', '--days-off', 'fred=2026-10-20', '--json'],
  ]
  for (const args of calls) {
    const result = run(root, args, { env })
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`)
    assert.deepEqual(errorOf(result), expected, args.join(' '))
    assert.equal(hashTree(root), before, args.join(' '))
  }
  assert.deepEqual(ghCalls(fake), [])
})

test('issues create with git_host.system gitlab exits 2 and creates no issue', () => {
  const root = makeRepo('team')
  editPmkit(root, ...GITLAB)
  const dir = path.join(root, '.issues', 'issues')
  const before = fs.readdirSync(dir)
  const result = run(root, ['issues', 'create', '--title', 'Second', '--type', 'task', '--json'])
  assert.equal(result.status, 2)
  assert.equal(errorOf(result).message, REFUSAL(HOST_MSG))
  assert.deepEqual(fs.readdirSync(dir), before)
})

test('pr sync refuses an invalid file even when it would move nothing', () => {
  const root = makeRepo('basic')
  editPmkit(root, ...GITLAB)
  const result = run(root, ['pr', 'sync', '--dry-run', '--json'])
  assert.equal(result.status, 2)
  assert.equal(errorOf(result).message, REFUSAL(HOST_MSG))
})

test('a write checks the config before its own flags', () => {
  const dir = tempDir('pmkit-order-')
  git(dir, 'init', '-q')
  for (const args of [['epic', 'create', '--json'], ['pr', 'open', '--json']]) {
    const result = run(dir, args)
    assert.equal(result.status, 2)
    assert.equal(errorOf(result).code, 'NOT_CONFIGURED', args.join(' '))
    assert.equal(errorOf(result).nextStep, '/pmkit:setup', args.join(' '))
  }
  const root = makeRepo('team')
  editPmkit(root, ...MAYBE)
  const result = run(root, ['epic', 'create', '--json'])
  assert.equal(result.status, 2)
  assert.equal(errorOf(result).message, REFUSAL(CONFIRM_MSG))
})

test('every read goes on with one warning', () => {
  const READS = {
    capabilities: [],
    discover: [],
    whoami: [],
    'issues list': [],
    'issues get': ['ISS-5N1R'],
    'issues dependencies': ['EPC-2M9D'],
    'cycle list': [],
    'cycle current': [],
    'cycle issues': ['2026-10-12'],
    'cycle capacity': ['2026-10-12'],
    'epic list': [],
    'epic get': ['EPC-2M9D'],
    'epic progress': ['EPC-2M9D'],
    'epic updates': ['EPC-2M9D'],
    'milestone list': [],
    'milestone get': ['v1.0'],
    'release list': [],
    'release get': ['1.0.0'],
    'release issues': ['1.0.0'],
    'release-notes': [],
    'docs read': ['missing.md'],
    'metrics velocity': [],
    'metrics cycle-time': [],
    'metrics lead-time': [],
    'metrics throughput': [],
    'metrics aging': [],
    events: [],
    risks: [],
    'pr status': [],
    reindex: [],
    render: ['board'],
  }
  assert.deepEqual(Object.keys(READS).sort(), [...COMMANDS.filter((c) => !c.write && !['init', 'changelog', 'validate'].includes(c.name)).map((c) => c.name), 'cycle capacity'].sort())
  const root = makeRepo('team')
  const runAll = () => Object.entries(READS).map(([name, argv]) => {
    const result = run(root, [...name.split(' '), ...argv, '--json'])
    let { stdout } = result
    if (name === 'capabilities') {
      const data = JSON.parse(stdout)
      delete data.generatedAt
      stdout = JSON.stringify(data)
    }
    return { name, status: result.status, stdout, stderr: result.stderr }
  })
  const valid = runAll()
  editPmkit(root, ...MAYBE)
  const invalid = runAll()
  for (const [i, first] of valid.entries()) {
    const second = invalid[i]
    assert.equal(second.status, first.status, first.name)
    assert.equal(second.stdout, first.stdout, first.name)
    // Some reads print their own warnings on this fixture (an issue with conflict markers); the config warning comes first.
    const count = (stderr) => stderr.split('\n').filter((line) => line === WARNING(CONFIRM_MSG)).length
    assert.equal(count(first.stderr), 0, first.name)
    assert.equal(count(second.stderr), 1, first.name)
    assert.equal(second.stderr, `${WARNING(CONFIRM_MSG)}\n${first.stderr}`, first.name)
  }
  for (const name of ['milestone get', 'docs read', 'pr status']) {
    assert.equal(invalid.find((r) => r.name === name).status, 2, name)
  }
})

test('pr status warns before its own error', () => {
  const root = makeRepo('team')
  editPmkit(root, ...GITLAB)
  const result = run(root, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(result.status, 2)
  assert.equal(errorOf(result).code, 'NOT_SUPPORTED')
  assert.equal(errorOf(result).message, 'this repository has no git host configured')
  assert.equal(result.stderr, `${WARNING(HOST_MSG)}\n`)
  const text = run(root, ['pr', 'status', '--branch', 'x'])
  assert.equal(text.status, 2)
  const lines = text.stderr.split('\n')
  assert.equal(lines[0], WARNING(HOST_MSG))
  assert.equal(lines[1], 'error: this repository has no git host configured')
})

test('text mode shows the refusal and the warning', () => {
  const root = makeRepo('team')
  const listed = run(root, ['issues', 'list'])
  assert.equal(listed.status, 0, listed.stderr)
  editPmkit(root, ...MAYBE)
  const created = run(root, ['issues', 'create', '--title', 'Second', '--type', 'task'])
  assert.equal(created.status, 2)
  assert.equal(created.stdout, '')
  assert.equal(created.stderr, `error: ${REFUSAL(CONFIRM_MSG)}\nnext: pmkit validate\n`)
  const again = run(root, ['issues', 'list'])
  assert.equal(again.status, 0)
  assert.equal(again.stdout, listed.stdout)
  assert.equal(again.stderr.split('\n')[0], WARNING(CONFIRM_MSG))
})

test('with both config files invalid, a write names .pmkit/config.yaml', () => {
  const root = makeRepo('team')
  editPmkit(root, ...MAYBE)
  const file = path.join(root, '.issues', 'config.yaml')
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(text.includes('default_status: backlog'))
  fs.writeFileSync(file, text.replace('default_status: backlog', 'default_status: nope'))
  const result = run(root, ['issues', 'create', '--title', 'Second', '--type', 'task', '--dry-run', '--json'])
  assert.equal(result.status, 2)
  assert.equal(errorOf(result).message, REFUSAL(CONFIRM_MSG))
})

test('a hand-written .pmkit/config.yaml with only version and tracker', () => {
  const root = makeRepo('team')
  fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), 'version: 1\ntracker:\n  system: local\n  path: .issues\n')
  const listed = run(root, ['issues', 'list', '--json'])
  assert.equal(listed.status, 0, listed.stderr)
  assert.ok(listed.stderr.split('\n').includes(WARNING(HOST_MSG, CONFIRM_MSG)), listed.stderr)
  const created = run(root, ['issues', 'create', '--title', 'Second', '--type', 'task', '--dry-run', '--json'])
  assert.equal(created.status, 2)
  assert.equal(errorOf(created).message, REFUSAL(HOST_MSG, CONFIRM_MSG))
})

test('the refusal names every bad key, and its next step lists them', () => {
  const root = makeRepo('team')
  editPmkit(root, ...GITLAB)
  editPmkit(root, 'confirm: single_writes', 'confirm: sometimes')
  const result = run(root, ['issues', 'create', '--title', 'Second', '--type', 'task', '--json'])
  assert.equal(result.status, 2)
  assert.equal(errorOf(result).message, `.pmkit/config.yaml is not valid, so writes are refused: ${HOST_MSG}; write_policy.confirm must be one of all_writes, single_writes, none`)
  const validated = json(root, ['validate'])
  assert.deepEqual(validated.problems.filter((p) => p.path === '.pmkit/config.yaml').map((p) => p.message), [HOST_MSG, CONFIRM_MSG])
})

test('an unknown tracker.system refuses reads with INVALID_INPUT', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: local', 'system: trello')
  const result = run(root, ['issues', 'list', '--json'])
  assert.equal(result.status, 2)
  assert.deepEqual(errorOf(result), {
    code: 'INVALID_INPUT',
    message: '.pmkit/config.yaml is not valid: tracker.system must be one of local, linear, jira, github, gitlab, azure-devops',
    nextStep: 'pmkit validate',
  })
  assert.doesNotMatch(result.stderr, /warning:/)
})

test('validate and changelog print no warning', () => {
  const root = makeRepo('team')
  editPmkit(root, ...MAYBE)
  for (const args of [['validate'], ['validate', '--json']]) {
    const result = run(root, args)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(CONFIRM_MSG), args.join(' '))
    assert.doesNotMatch(result.stderr, /^warning: \.pmkit/m)
  }
  const changelog = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
  const result = run(root, ['changelog', '--file', changelog, '--since', '0.1.0'])
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /^warning: \.pmkit/m)
})

test('release list prints no releases on an empty tracker and a table after a create', () => {
  const root = makeRepo('basic')
  assert.equal(run(root, ['release', 'list']).stdout.trim(), 'no releases')
  assert.deepEqual(json(root, ['release', 'list']), [])
  json(root, ['release', 'create', '1.2.0', '--name', 'Webhooks', '--tag', 'v1.2.0', '--target', '2026-11-30'])
  const lines = run(root, ['release', 'list']).stdout.split('\n')
  assert.match(lines[0], /^ID\s+\| Name\s+\| State\s+\| Tag\s+\| Target\s+\| Released$/)
  assert.match(lines[2], /^1\.2\.0\s+\| Webhooks\s+\| planned\s+\| v1\.2\.0\s+\| 2026-11-30 \|$/)
  assert.deepEqual(json(root, ['release', 'list', '--state', 'released']), [])
  assert.deepEqual(json(root, ['release', 'list', '--state', 'planned']).map((r) => r.id), ['1.2.0'])
  const bad = run(root, ['release', 'list', '--state', 'open', '--json'])
  assert.equal(bad.status, 2)
  assert.equal(JSON.parse(bad.stdout).error.code, 'INVALID_INPUT')
})

test('release get prints the record and a miss is NOT_FOUND', () => {
  const root = makeRepo('basic')
  json(root, ['release', 'create', '1.2.0', '--name', 'Webhooks', '--tag', 'v1.2.0', '--target', '2026-11-30'])
  const text = run(root, ['release', 'get', '1.2.0']).stdout
  for (const line of ['id: 1.2.0', 'name: Webhooks', 'state: planned', 'tag: v1.2.0', 'target: 2026-11-30']) assert.ok(text.split('\n').includes(line), line)
  const miss = run(root, ['release', 'get', 'nope', '--json'])
  assert.equal(miss.status, 2)
  assert.deepEqual(JSON.parse(miss.stdout).error, { code: 'NOT_FOUND', message: 'release nope does not exist', nextStep: 'pmkit release list' })
})

test('release issues --archived lists archived members', () => {
  const root = makeRepo('basic')
  json(root, ['release', 'create', '1.2.0'])
  const ids = [1, 2].map((n) => json(root, ['issues', 'create', '--title', `Member ${n}`]).after.id)
  for (const id of ids) json(root, ['issues', 'update', id, '--release', '1.2.0'])
  json(root, ['issues', 'archive', ids[1]])
  assert.deepEqual(json(root, ['release', 'issues', '1.2.0']).map((i) => i.id), [ids[0]])
  assert.deepEqual(json(root, ['release', 'issues', '1.2.0', '--archived']).map((i) => i.id).sort(), [...ids].sort())
  const text = run(root, ['release', 'issues', '1.2.0', '--archived']).stdout
  for (const id of ids) assert.ok(text.includes(id), id)
})

const notes = (root, args = []) => json(root, ['release-notes', ...args])

test('release-notes without a selector uses the latest released release and lists archived done issues', () => {
  const root = makeRepo('basic')
  json(root, ['release', 'create', '1.2.0', '--tag', 'v1.2.0'])
  const ids = {}
  for (const type of ['feature', 'bug', 'chore']) {
    ids[type] = json(root, ['issues', 'create', '--title', `A ${type}`, '--type', type]).after.id
    json(root, ['issues', 'update', ids[type], '--release', '1.2.0'])
    json(root, ['issues', 'move', ids[type], 'done'])
  }
  json(root, ['issues', 'archive', ids.bug])
  json(root, ['release', 'mark-released', '1.2.0'])
  const result = notes(root)
  assert.equal(result.basis, 'release')
  assert.equal(result.reason, 'latest')
  assert.equal(result.draft, false)
  assert.deepEqual(result.groups.map((g) => g.type), ['feature', 'bug'])
  assert.equal(result.groups[1].issues[0].archived, true)
  assert.equal(result.counts.excluded.chore, 1)
  assert.ok(run(root, ['release-notes']).stdout.startsWith('release 1.2.0 (tag v1.2.0, released 2026-10-23)'))
})

test('release-notes --release on a planned release is a draft', () => {
  const root = makeRepo('no-sprints')
  const result = notes(root, ['--release', '1.0.0'])
  assert.equal(result.draft, true)
  assert.equal(result.reason, 'requested')
  assert.deepEqual(result.groups.flatMap((g) => g.issues.map((i) => i.id)), ['ISS-6R3N'])
  assert.equal(result.counts.excluded.open, 1)
  assert.ok(run(root, ['release-notes', '--release', '1.0.0']).stdout.split('\n').includes('draft: release 1.0.0 is not released yet'))
})

test('release-notes falls back to the latest closed sprint', () => {
  const root = makeRepo('team')
  const result = notes(root)
  assert.equal(result.basis, 'sprint')
  assert.equal(result.source.id, '2026-09-28')
  assert.equal(result.reason, 'no_released_release')
  for (const group of result.groups) for (const entry of group.issues) assert.ok(entry.doneAt)
  assert.equal(run(root, ['release-notes']).stdout.split('\n')[1], 'no released release, so the notes use sprint 2026-09-28')
})

test('release-notes --sprint on an active sprint is a draft', () => {
  assert.equal(notes(makeRepo('team'), ['--sprint', '2026-10-12']).draft, true)
})

test('release-notes falls back to the default period and says so', () => {
  const root = makeRepo('no-sprints')
  const result = notes(root)
  assert.equal(result.basis, 'period')
  assert.deepEqual(result.period, { since: '2026-10-09', until: '2026-10-23', defaulted: true })
  assert.equal(result.reason, 'no_closed_sprint')
  const text = run(root, ['release-notes']).stdout
  assert.ok(text.includes('period 2026-10-09 to 2026-10-23 (default window)'))
  assert.ok(text.includes('no released release, no closed sprint, so the notes use the last 14 days'))
})

test('release-notes --since keeps a done issue and drops a reopened one', () => {
  const root = makeRepo('team')
  const listed = () => notes(root, ['--since', '2026-09-01', '--until', '2026-10-31']).groups.flatMap((g) => g.issues.map((i) => i.id))
  assert.ok(listed().includes('ISS-7K3Q'))
  json(root, ['issues', 'move', 'ISS-7K3Q', 'in_progress'])
  const after = notes(root, ['--since', '2026-09-01', '--until', '2026-10-31'])
  assert.ok(!after.groups.flatMap((g) => g.issues.map((i) => i.id)).includes('ISS-7K3Q'))
  assert.ok(after.counts.excluded.open >= 1)
})

test('release-notes names an unknown release or sprint NOT_FOUND', () => {
  const root = makeRepo('team')
  const release = run(root, ['release-notes', '--release', 'nope', '--json'])
  assert.equal(release.status, 2)
  assert.equal(JSON.parse(release.stdout).error.code, 'NOT_FOUND')
  assert.equal(JSON.parse(release.stdout).error.nextStep, 'pmkit release list')
  const sprint = run(root, ['release-notes', '--sprint', 'nope', '--json'])
  assert.equal(sprint.status, 2)
  assert.equal(JSON.parse(sprint.stdout).error.code, 'NOT_FOUND')
  assert.equal(JSON.parse(sprint.stdout).error.nextStep, 'pmkit cycle list')
})

test('release-notes refuses bad selectors', () => {
  const root = makeRepo('team')
  for (const args of [['--release', '1.0.0', '--sprint', 'x'], ['--release', '1.0.0', '--since', '2026-10-01'], ['--until', '2026-10-01'], ['--since', '2026-10-05', '--until', '2026-10-01'], ['--since', '2026-13-01']]) {
    const result = run(root, ['release-notes', ...args, '--json'])
    assert.equal(result.status, 2, args.join(' '))
    const error = JSON.parse(result.stdout).error
    assert.equal(error.code, 'INVALID_INPUT', args.join(' '))
    if (!args.includes('2026-13-01')) assert.equal(error.nextStep, 'pmkit release-notes --help', args.join(' '))
  }
})

test('release-notes puts an unreadable issue in problems and still answers', () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues/issues/ISS-7K3Q/issue.md'), { force: true })
  const result = run(root, ['release-notes', '--since', '2026-09-01', '--until', '2026-10-31', '--json'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(JSON.parse(result.stdout).problems.some((p) => p.id === 'ISS-7K3Q'))
  assert.match(result.stderr, /^warning: ISS-7K3Q: /m)
})

test('release-notes writes nothing and takes no write flag', () => {
  const root = makeRepo('team')
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@x.dev')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'fixture')
  assert.equal(run(root, ['release-notes']).status, 0)
  assert.equal(run(root, ['release-notes', '--json']).status, 0)
  assert.equal(git(root, 'status', '--porcelain').stdout, '')
  for (const flag of [['--dry-run'], ['--as', 'fred']]) {
    const result = run(root, ['release-notes', ...flag])
    assert.equal(result.status, 2)
    assert.match(result.stderr + result.stdout, /unknown option/)
  }
})

test('release create --dry-run writes nothing, and a bad id is INVALID_INPUT', () => {
  const root = makeRepo('basic')
  const before = hashTree(path.join(root, '.issues'))
  const dry = json(root, ['release', 'create', '1.2.0', '--dry-run'])
  assert.equal(dry.before, null)
  assert.equal(dry.after.id, '1.2.0')
  assert.deepEqual(hashTree(path.join(root, '.issues')), before)
  const bad = run(root, ['release', 'create', 'bad+id', '--json'])
  assert.equal(bad.status, 2)
  assert.equal(JSON.parse(bad.stdout).error.code, 'INVALID_INPUT')
  assert.ok(!fs.existsSync(path.join(root, '.issues/releases')))
})

test('release create and mark-released commit as pmkit: release <command> <id> when auto commit is on', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  json(root, ['release', 'create', '1.2.0'])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), 'pmkit: release create 1.2.0')
  json(root, ['release', 'mark-released', '1.2.0'])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), 'pmkit: release mark-released 1.2.0')
})

test('issues create and update take --release, and a missing release is refused with a next step', () => {
  const root = makeRepo('basic')
  json(root, ['release', 'create', '1.2.0'])
  const { after } = json(root, ['issues', 'create', '--title', 'T', '--release', '1.2.0'])
  assert.equal(after.release, '1.2.0')
  assert.equal(json(root, ['issues', 'update', after.id, '--release', 'none']).after.release, undefined)
  const missing = run(root, ['issues', 'update', after.id, '--release', '9.9.9', '--json'])
  assert.equal(missing.status, 2)
  assert.deepEqual(JSON.parse(missing.stdout).error, { code: 'INVALID_INPUT', message: 'release 9.9.9 does not exist', nextStep: 'pmkit release create 9.9.9' })
})

test('issues update --release refuses a release file that does not parse, before it writes anything', () => {
  const root = makeRepo('basic')
  json(root, ['release', 'create', '9.0'])
  const { after } = json(root, ['issues', 'create', '--title', 'T'])
  const issueFile = path.join(root, '.issues', 'issues', after.id, 'issue.md')
  const eventsFile = path.join(root, '.issues', 'issues', after.id, 'events.jsonl')
  const issueBefore = fs.readFileSync(issueFile, 'utf8')
  const eventsBefore = fs.readFileSync(eventsFile, 'utf8')
  fs.writeFileSync(path.join(root, '.issues', 'releases', '9.0.md'), '---\ntag: v1..2\n---\n')
  const result = run(root, ['issues', 'update', after.id, '--release', '9.0', '--json'])
  assert.equal(result.status, 2)
  const error = JSON.parse(result.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, '/pmkit:local:doctor')
  assert.equal(fs.readFileSync(issueFile, 'utf8'), issueBefore)
  assert.equal(fs.readFileSync(eventsFile, 'utf8'), eventsBefore)
})

// A release 1.2.0 with one issue in todo and one done, plus an issue outside it.
function releaseWithIssues(tag) {
  const root = makeRepo('basic')
  json(root, ['release', 'create', '1.2.0', ...(tag ? ['--tag', tag] : [])])
  const open = json(root, ['issues', 'create', '--title', 'Open', '--release', '1.2.0']).after
  const done = json(root, ['issues', 'create', '--title', 'Done', '--release', '1.2.0']).after
  json(root, ['issues', 'move', done.id, 'done'])
  const other = json(root, ['issues', 'create', '--title', 'Other']).after
  return { root, open, done, other }
}

test('release issues lists the member issues as a table and as JSON', () => {
  const { root, open, done, other } = releaseWithIssues()
  const text = run(root, ['release', 'issues', '1.2.0']).stdout
  assert.ok(text.includes(open.id) && text.includes(done.id) && !text.includes(other.id))
  assert.deepEqual(json(root, ['release', 'issues', '1.2.0']).map((i) => i.id).sort(), [open.id, done.id].sort())
})

test('release mark-released prints the unfinished issues and warns, and --dry-run writes nothing', () => {
  const { root, open, done } = releaseWithIssues()
  const dry = run(root, ['release', 'mark-released', '1.2.0', '--dry-run'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(dry.stdout.trimEnd().split('\n').at(-1), 'dry run: nothing was written')
  assert.equal(json(root, ['release', 'get', '1.2.0']).state, 'planned')
  const result = run(root, ['release', 'mark-released', '1.2.0'])
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.split('\n')
  assert.ok(lines.some((line) => line.startsWith('released:')))
  assert.ok(lines.includes('unfinished issues:'))
  assert.ok(result.stdout.includes(open.id) && !result.stdout.slice(result.stdout.indexOf('unfinished')).includes(done.id))
  assert.match(result.stderr, new RegExp(`warning: release 1\\.2\\.0 has 1 unfinished issue: ${open.id}\\n`))
  assert.equal(json(root, ['release', 'get', '1.2.0']).state, 'released')
  const again = run(root, ['release', 'mark-released', '1.2.0', '--json'])
  assert.equal(again.status, 2)
  assert.equal(JSON.parse(again.stdout).error.code, 'CONFLICT')
})

test('release mark-released lists several unfinished issues in the warning', () => {
  const { root, open } = releaseWithIssues()
  const second = json(root, ['issues', 'create', '--title', 'Second', '--release', '1.2.0']).after
  const result = run(root, ['release', 'mark-released', '1.2.0'])
  assert.match(result.stderr, new RegExp(`warning: release 1\\.2\\.0 has 2 unfinished issues: ${[open.id, second.id].sort().join(', ')}\\n`))
})

test('putting an issue in a released release warns, dry runs included', () => {
  const { root, other } = releaseWithIssues()
  json(root, ['release', 'mark-released', '1.2.0'])
  const update = run(root, ['issues', 'update', other.id, '--release', '1.2.0'])
  assert.equal(update.status, 0, update.stderr)
  assert.match(update.stderr, /warning: release 1\.2\.0 is already released\n/)
  const dry = run(root, ['issues', 'create', '--title', 'N', '--release', '1.2.0', '--dry-run'])
  assert.match(dry.stderr, /warning: release 1\.2\.0 is already released\n/)
})

function gitRepoWithCommit(root) {
  git(root, 'init', '-q')
  git(root, '-c', 'user.name=T', '-c', 'user.email=t@x.dev', 'commit', '-q', '--allow-empty', '-m', 'init')
}

test('release mark-released checks the tag against the repository and warns only on a miss', () => {
  const tagged = releaseWithIssues('v1.2.0')
  gitRepoWithCommit(tagged.root)
  git(tagged.root, 'tag', 'v1.2.0')
  const found = run(tagged.root, ['release', 'mark-released', '1.2.0'])
  assert.equal(found.status, 0, found.stderr)
  assert.doesNotMatch(found.stderr, /tag/)

  const missing = releaseWithIssues('v1.2.0')
  gitRepoWithCommit(missing.root)
  const result = run(missing.root, ['release', 'mark-released', '1.2.0'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /warning: tag v1\.2\.0 is not in this repository; create and push it, or run git fetch --tags\n/)
  assert.equal(json(missing.root, ['release', 'get', '1.2.0']).state, 'released')
})

test('release mark-released outside a git repository marks the release and warns that the tag cannot be checked', () => {
  const { root } = releaseWithIssues('v1.2.0')
  const result = run(root, ['release', 'mark-released', '1.2.0'], { env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /warning: cannot check tag v1\.2\.0: not a git repository/)
  assert.equal(json(root, ['release', 'get', '1.2.0']).state, 'released')
})

test('release mark-released with no git on PATH marks the release and warns', () => {
  const { root } = releaseWithIssues('v1.2.0')
  const empty = tempDir('pmkit-nopath-')
  const result = spawnSync(process.execPath, [CLI, 'release', 'mark-released', '1.2.0'], { cwd: root, env: { ...baseEnv(), PATH: empty }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /warning: cannot check tag v1\.2\.0: git is not installed or not on PATH\n/)
  assert.equal(json(root, ['release', 'get', '1.2.0']).state, 'released')
})

test('release mark-released on a release with no tag runs no git and prints no tag warning', () => {
  const { root } = releaseWithIssues()
  const result = run(root, ['release', 'mark-released', '1.2.0'], { env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /tag/)
})
