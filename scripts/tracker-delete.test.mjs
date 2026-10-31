import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issuePaths } from './lib/local/store.mjs'
import { hashTree, makeRepo, scriptedRandom } from './test-helpers.mjs'

function setup(count = 3, { agent = false } = {}) {
  const root = makeRepo()
  const issuesDir = path.join(root, '.issues')
  if (agent) {
    const file = path.join(issuesDir, 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('members:\n', 'members:\n  agent:claude: { name: Claude }\n'))
  }
  const tracker = createLocalTracker(root, {
    now: () => new Date('2026-10-23T12:00:00Z'),
    random: scriptedRandom(Array.from({ length: count }, (_, i) => [1, 2, 3, 4 + i]).flat()),
  })
  const ids = Array.from({ length: count }, (_, i) => tracker.createIssue({ title: `Issue ${i}` }, 'fred').after.id)
  return { root, issuesDir, tracker, ids }
}

const refused = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  assert.fail('expected a refusal')
}

test('delete removes the issue folder, and search and get forget it', () => {
  const { tracker, issuesDir, ids: [a, ...rest] } = setup()
  const result = tracker.delete(a, 'fred')
  assert.equal(result.after, null)
  assert.equal(result.before.id, a)
  assert.deepEqual(result.references, [])
  assert.equal(fs.existsSync(issuePaths(issuesDir, a).dir), false)
  assert.deepEqual(tracker.searchIssues({ archived: true }).issues.map((issue) => issue.id), rest)
  assert.throws(() => tracker.getIssue(a), { code: 'NOT_FOUND' })
  assert.throws(() => tracker.delete(a, 'fred'), { code: 'NOT_FOUND' })
})

test('delete drops the issue from the query index in the same call', () => {
  const { tracker, issuesDir, ids: [a] } = setup()
  tracker.searchIssues({})
  const indexFile = path.join(issuesDir, '.cache', 'index.json')
  assert.ok(fs.readFileSync(indexFile, 'utf8').includes(a))
  tracker.delete(a, 'fred')
  assert.equal(fs.readFileSync(indexFile, 'utf8').includes(a), false)
})

test('a dry run writes nothing, not even the index', () => {
  const { tracker, root, ids: [a] } = setup()
  const before = hashTree(root)
  const result = tracker.delete(a, 'fred', { dryRun: true })
  assert.equal(result.before.id, a)
  assert.equal(result.after, null)
  assert.equal(hashTree(root), before)
  assert.deepEqual(tracker.writtenFiles().filter((file) => file.includes(a) && !file.endsWith('issue.md') && !file.endsWith('events.jsonl')), [])
})

test('removes lists the files, the events and the comments that go', () => {
  const { tracker, ids: [a] } = setup()
  tracker.comment(a, 'first', 'fred')
  const { removes } = tracker.delete(a, 'fred', { dryRun: true })
  assert.equal(removes.dir, `.issues/issues/${a}`)
  assert.equal(removes.comments, 1)
  assert.ok(removes.events >= 1)
  assert.ok(removes.files.includes(`.issues/issues/${a}/issue.md`))
  assert.ok(removes.files.includes(`.issues/issues/${a}/events.jsonl`))
  assert.equal(removes.files.filter((file) => file.includes('/comments/')).length, 1)
})

test('blockedBy of another issue blocks, and the error lists it with the unlink command', () => {
  const { tracker, ids: [a, b] } = setup()
  tracker.link(a, b, 'blocks', 'fred')
  const error = refused(() => tracker.delete(a, 'fred'))
  assert.equal(error.code, 'CONFLICT')
  assert.deepEqual(error.details.references, [{ id: b, kind: 'blockedBy' }])
  assert.match(error.message, new RegExp(`${b} \\(blockedBy\\)`))
  assert.match(error.nextStep, new RegExp(`issues link ${a} ${b} --kind blocks --remove`))
})

test('related of another issue blocks', () => {
  const { tracker, ids: [a, b] } = setup()
  tracker.link(a, b, 'related', 'fred')
  assert.deepEqual(refused(() => tracker.delete(a, 'fred')).details.references, [{ id: b, kind: 'related' }])
})

test('duplicateOf of another issue blocks', () => {
  const { tracker, ids: [a, b] } = setup()
  tracker.link(b, a, 'duplicate', 'fred')
  const error = refused(() => tracker.delete(a, 'fred'))
  assert.deepEqual(error.details.references, [{ id: b, kind: 'duplicateOf' }])
  assert.match(error.nextStep, new RegExp(`issues link ${b} ${a} --kind duplicate --remove`))
})

test('a child blocks, an archived child too, and a dry run refuses the same way', () => {
  const { tracker, ids: [a, b] } = setup()
  tracker.setParent(b, a, 'fred')
  tracker.archive(b, 'fred')
  const error = refused(() => tracker.delete(a, 'fred', { dryRun: true }))
  assert.deepEqual(error.details.references, [{ id: b, kind: 'parent' }])
  assert.match(error.nextStep, new RegExp(`issues parent ${b} none`))
})

test('one issue that references through two kinds is listed twice', () => {
  const { tracker, ids: [a, b] } = setup()
  tracker.link(a, b, 'related', 'fred')
  tracker.setParent(b, a, 'fred')
  assert.deepEqual(refused(() => tracker.delete(a, 'fred')).details.references, [{ id: b, kind: 'related' }, { id: b, kind: 'parent' }])
})

test('the own links of the issue do not block, and they go with it', () => {
  const { tracker, ids: [a, b, c] } = setup()
  tracker.link(b, a, 'blocks', 'fred')
  tracker.link(a, c, 'duplicate', 'fred')
  tracker.setParent(a, b, 'fred')
  assert.equal(tracker.delete(a, 'fred').after, null)
  assert.deepEqual(tracker.getIssue(b).blocks, [])
})

test('an issue file that does not parse refuses and lists the problem', () => {
  const { tracker, issuesDir, ids: [a, b] } = setup()
  fs.writeFileSync(issuePaths(issuesDir, b).file, '<<<<<<< HEAD\nbroken\n=======\n>>>>>>> x\n')
  const error = refused(() => tracker.delete(a, 'fred'))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.deepEqual(error.details.problems.map((problem) => problem.id), [b])
  assert.match(error.nextStep, /pmkit validate/)
  assert.equal(fs.existsSync(issuePaths(issuesDir, a).dir), true)
})

test('warnings: sprint, released release, agent assignee, logged time, todo-key, view and branch', () => {
  const { tracker, ids: [a] } = setup(1, { agent: true })
  tracker.openCycle({ start: '2026-10-20' }, 'fred')
  tracker.createRelease({ id: '1.0.0' }, 'fred')
  tracker.updateIssue(a, {
    sprint: 'current', release: '1.0.0', branch: 'work-branch', description: 'Fix it.\n\ntodo-key: 0123456789ab',
  }, 'fred')
  tracker.markReleased('1.0.0', 'fred')
  tracker.assign(a, 'agent:claude', 'fred')
  tracker.logTime(a, 30, 'fred')
  tracker.logTime(a, 15, 'fred')
  tracker.saveView('children', { parent: a }, 'fred')
  const { warnings } = tracker.delete(a, 'fred', { dryRun: true })
  const text = warnings.join('\n')
  assert.match(text, /sprint 2026-10-20/)
  assert.match(text, /release 1\.0\.0 is already released/)
  assert.match(text, /assigned to agent:claude/)
  assert.match(text, /45 minutes logged/)
  assert.match(text, /todo-key/)
  assert.match(text, /view children/)
  assert.match(text, /branch work-branch/)
})

test('a plain issue has no warnings and says what it did not scan', () => {
  const { tracker, ids: [a] } = setup(1)
  const result = tracker.delete(a, 'fred', { dryRun: true })
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.mentions, [])
  assert.deepEqual(result.unchecked, ['code comments, documents and docs/'])
})

test('mentions list other issues and comments that cite the ID, and PMK-5 style prefixes do not match', () => {
  const { tracker, ids: [a, b, c] } = setup()
  tracker.updateIssue(b, { description: `See ${a} for context.` }, 'fred')
  tracker.comment(c, `Duplicate of ${a}.`, 'fred')
  const near = `${a}5`
  tracker.updateIssue(a, { description: 'no self mention' }, 'fred')
  const { mentions } = tracker.delete(a, 'fred', { dryRun: true })
  assert.deepEqual(mentions, [{ id: b, in: 'description' }, { id: c, in: 'comment' }])
  tracker.updateIssue(b, { description: `See ${near} only.` }, 'fred')
  assert.deepEqual(tracker.delete(a, 'fred', { dryRun: true }).mentions, [{ id: c, in: 'comment' }])
})

test('writtenFiles carries the removed folder so auto_commit stages the removal', () => {
  const { tracker, ids: [a] } = setup()
  const files = () => tracker.writtenFiles()
  tracker.delete(a, 'fred')
  assert.ok(files().includes(`.issues/issues/${a}`))
})

test('delete needs a member as actor', () => {
  const { tracker, ids: [a] } = setup()
  assert.throws(() => tracker.delete(a, 'nobody'), { code: 'INVALID_INPUT' })
})
