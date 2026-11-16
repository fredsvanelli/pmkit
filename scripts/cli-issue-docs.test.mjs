// The docs field of an issue (PMK-228): issues update --add-doc and --remove-doc on the Local tracker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo } from './test-helpers.mjs'
import { parseIssueFile, toFrontmatter } from './lib/local/issue-file.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'

const ID = 'ISS-5N1R'
const cli = async (root, ...args) => {
  const result = await run([...args, '--json'], { cwd: root, env: childEnv() })
  return { code: result.code, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr }
}
const issueFile = (root) => path.join(root, '.issues', 'issues', ID, 'issue.md')
const events = (root) => fs.readFileSync(path.join(root, '.issues', 'issues', ID, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

test('parseIssueFile reads docs, and toFrontmatter leaves an empty or missing list out', () => {
  const issue = parseIssueFile('---\nid: ISS-1\ntitle: T\nstatus: todo\ndocs: [docs/adr/0001-a.md]\n---\n')
  assert.deepEqual(issue.docs, ['docs/adr/0001-a.md'])
  assert.equal(issue.extra, undefined)
  assert.equal(toFrontmatter({ ...issue, docs: [] }).docs, undefined)
  assert.equal(toFrontmatter({ ...issue, docs: undefined }).docs, undefined)
  assert.equal('docs' in parseIssueFile('---\nid: ISS-1\ntitle: T\nstatus: todo\n---\n'), false)
})

test('--add-doc adds a path with one docs event, and adding it again changes nothing', async () => {
  const root = makeRepo('team')
  const before = events(root).length
  const first = await cli(root, 'issues', 'update', ID, '--add-doc', 'docs/adr/0001-a.md')
  assert.equal(first.code, 0, first.stderr)
  assert.deepEqual(first.data.after.docs, ['docs/adr/0001-a.md'])
  assert.equal(first.data.before.docs, undefined)
  assert.match(fs.readFileSync(issueFile(root), 'utf8'), /^docs: \[?docs\/adr\/0001-a\.md/m)
  const added = events(root).slice(before)
  assert.deepEqual(added.map((event) => [event.op, event.field, event.from, event.to]), [['update', 'docs', null, ['docs/adr/0001-a.md']]])
  const again = await cli(root, 'issues', 'update', ID, '--add-doc', 'docs/adr/0001-a.md')
  assert.equal(again.code, 0, again.stderr)
  assert.deepEqual(again.data.after, again.data.before)
  assert.equal(events(root).length, before + 1)
})

test('--remove-doc removes the path and the key, and removing an absent path changes nothing', async () => {
  const root = makeRepo('team')
  await cli(root, 'issues', 'update', ID, '--add-doc', 'docs/adr/0001-a.md', '--add-doc', 'docs/adr/0002-b.md')
  const removed = await cli(root, 'issues', 'update', ID, '--remove-doc', 'docs/adr/0001-a.md')
  assert.equal(removed.code, 0, removed.stderr)
  assert.deepEqual(removed.data.after.docs, ['docs/adr/0002-b.md'])
  const last = await cli(root, 'issues', 'update', ID, '--remove-doc', 'docs/adr/0002-b.md')
  assert.equal(last.data.after.docs, undefined)
  assert.doesNotMatch(fs.readFileSync(issueFile(root), 'utf8'), /^docs:/m)
  const count = events(root).length
  const absent = await cli(root, 'issues', 'update', ID, '--remove-doc', 'docs/adr/0009-x.md')
  assert.equal(absent.code, 0, absent.stderr)
  assert.deepEqual(absent.data.after, absent.data.before)
  assert.equal(events(root).length, count)
})

test('--add-doc --dry-run writes nothing', async () => {
  const root = makeRepo('team')
  const text = fs.readFileSync(issueFile(root), 'utf8')
  const result = await cli(root, 'issues', 'update', ID, '--add-doc', 'docs/adr/0001-a.md', '--dry-run')
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.data.after.docs, ['docs/adr/0001-a.md'])
  assert.equal(fs.readFileSync(issueFile(root), 'utf8'), text)
})

test('a docs entry that is blank or holds a line break is refused, and the list is kept without repeats', async () => {
  const root = makeRepo('team')
  assert.equal((await cli(root, 'issues', 'update', ID, '--add-doc', ' ')).code, 2)
  const tracker = createLocalTracker(root)
  assert.throws(() => tracker.updateIssue(ID, { docs: ['a\nb'] }, 'fred'), { code: 'INVALID_INPUT' })
  assert.throws(() => tracker.updateIssue(ID, { docs: 'a' }, 'fred'), { code: 'INVALID_INPUT' })
  assert.deepEqual(tracker.updateIssue(ID, { docs: ['a.md', ' a.md ', 'b.md'] }, 'fred', { dryRun: true }).after.docs, ['a.md', 'b.md'])
})

// PMK-228 review: a docs value that is not a list of one-line, non-blank, distinct paths is a broken file, never coerced to a string.
const withDocs = (value) => `---\nid: ISS-1\ntitle: T\nstatus: todo\ndocs: ${value}\n---\n`

test('parseIssueFile refuses docs that are blank, not text, or repeated, and accepts one path as a list', () => {
  for (const value of ['""', '[""]', '[{a: 1}]', '[a.md, 7]', '[a.md, a.md]', '{a: 1}', 'true']) {
    assert.throws(() => parseIssueFile(withDocs(value)), { code: 'INVALID_INPUT', message: /docs must be a list of one-line, non-blank paths with no repeats/ }, value)
  }
  assert.deepEqual(parseIssueFile(withDocs('a.md')).docs, ['a.md'])
  assert.equal('docs' in parseIssueFile(withDocs('[]')), false)
  assert.equal('docs' in parseIssueFile('---\nid: ISS-1\ntitle: T\nstatus: todo\ndocs:\n---\n'), false)
})

test('validate reports bad docs as a frontmatter problem, and an update never writes them back', async () => {
  const root = makeRepo('team')
  const { validateRepo } = await import('./lib/validate.mjs')
  const text = fs.readFileSync(issueFile(root), 'utf8').replace(/^title: /m, 'docs: [{a: 1}]\ntitle: ')
  fs.writeFileSync(issueFile(root), text)
  const problems = validateRepo(root).problems.filter((problem) => problem.path === `.issues/issues/${ID}/issue.md`)
  assert.deepEqual(problems.map((problem) => problem.code), ['frontmatter'])
  assert.match(problems[0].message, /docs must be a list/)
  const update = await cli(root, 'issues', 'update', ID, '--title', 'Renamed')
  assert.equal(update.code, 2)
  assert.equal(fs.readFileSync(issueFile(root), 'utf8'), text)
})

test('--add-doc or --remove-doc with no value, alone or repeated, is a usage error, not UNEXPECTED (PMK-228 review)', async () => {
  const root = makeRepo('team')
  const text = fs.readFileSync(issueFile(root), 'utf8')
  for (const args of [['--add-doc', 'a.md', '--add-doc'], ['--remove-doc', 'a.md', '--remove-doc'], ['--add-doc'], ['--remove-doc', ' ']]) {
    const result = await cli(root, 'issues', 'update', ID, ...args, '--dry-run')
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(result.data.error.code, 'INVALID_INPUT', `${args.join(' ')}: ${result.data.error.message}`)
    assert.match(result.data.error.message, /--(add|remove)-doc needs a (path|value)/, args.join(' '))
  }
  assert.equal(fs.readFileSync(issueFile(root), 'utf8'), text)
})
