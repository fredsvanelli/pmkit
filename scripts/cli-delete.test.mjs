import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, makeRepo } from './test-helpers.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')
const ENV = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }

const run = (cwd, args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: ENV, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
const json = (cwd, args) => {
  const result = run(cwd, [...args, '--json'])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV })

/** A git repo with the basic fixture committed and auto_commit set, and the ids of three new issues. */
function withRepo({ autoCommit = false } = {}, fn) {
  const root = makeRepo('basic')
  try {
    const ids = ['One', 'Two', 'Three'].map((title) => json(root, ['issues', 'create', '--title', title]).after.id)
    const file = path.join(root, '.issues/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^auto_commit: .*$/m, `auto_commit: ${autoCommit}`))
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    fn(root, ids)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('the dry run is the full preview and writes nothing', () => {
  withRepo({}, (root, [a]) => {
    const comment = path.join(root, 'c.md')
    fs.writeFileSync(comment, 'A note.')
    json(root, ['issues', 'comment', a, '--body-file', comment])
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'comment')
    const before = hashTree(root)
    const result = run(root, ['issues', 'delete', a, '--dry-run'])
    assert.equal(result.status, 0, result.stderr)
    for (const part of [`would delete ${a}`, 'title: One', 'removes:', `.issues/issues/${a}/issue.md`, '2 events and 1 comment go with it', 'Nothing commits this delete', 'references: no other issue', `archive instead: pmkit issues archive ${a}`, 'dry run: nothing was written']) {
      assert.ok(result.stdout.includes(part), `${part}\n${result.stdout}`)
    }
    assert.equal(hashTree(root), before)
    const data = json(root, ['issues', 'delete', a, '--dry-run'])
    assert.equal(data.after, null)
    assert.equal(data.before.id, a)
    assert.equal(data.removes.comments, 1)
    assert.deepEqual(data.warnings, [])
    assert.deepEqual(data.references, [])
    assert.equal(hashTree(root), before)
  })
})

test('the preview names git history only when auto_commit commits the delete, and counts one event and one comment in the singular', () => {
  withRepo({ autoCommit: true }, (root, [a]) => {
    const on = run(root, ['issues', 'delete', a, '--dry-run'])
    assert.match(on.stdout, /1 event and 0 comments go with it\. Only git history can bring them back\./)
    assert.doesNotMatch(on.stdout, /Nothing commits/)
    assert.equal(json(root, ['issues', 'delete', a, '--dry-run']).removes.autoCommit, true)
  })
  withRepo({}, (root, [a]) => {
    const off = run(root, ['issues', 'delete', a, '--dry-run'])
    assert.doesNotMatch(off.stdout, /Only git history/)
    assert.match(off.stdout, /1 event and 0 comments go with it\. Nothing commits this delete/)
    assert.equal(json(root, ['issues', 'delete', a, '--dry-run']).removes.autoCommit, false)
  })
})

test('the real run removes the folder and the issue is gone from list and get', () => {
  withRepo({}, (root, [a, b]) => {
    const text = run(root, ['issues', 'delete', a])
    assert.equal(text.status, 0, text.stderr)
    assert.match(text.stdout, new RegExp(`^deleted ${a}`))
    assert.equal(fs.existsSync(path.join(root, '.issues/issues', a)), false)
    assert.ok(!json(root, ['issues', 'list', '--archived']).issues.some((issue) => issue.id === a))
    assert.ok(json(root, ['issues', 'list']).issues.some((issue) => issue.id === b))
    const got = run(root, ['issues', 'get', a, '--json'])
    assert.equal(got.status, 2)
    assert.equal(JSON.parse(got.stdout).error.code, 'NOT_FOUND')
  })
})

test('a referenced issue is refused with the same list in the message and the JSON, for a dry run too', () => {
  withRepo({}, (root, [a, b, c]) => {
    json(root, ['issues', 'link', a, b, '--kind', 'blocks'])
    json(root, ['issues', 'parent', c, a])
    const [first, second] = [{ id: b, kind: 'blockedBy' }, { id: c, kind: 'parent' }].sort((x, y) => (x.id < y.id ? -1 : 1))
    const before = hashTree(root)
    for (const flags of [[], ['--dry-run']]) {
      const text = run(root, ['issues', 'delete', a, ...flags])
      assert.equal(text.status, 2)
      assert.match(text.stderr, new RegExp(`error: ${a} is referenced by 2 records: ${first.id} \\(${first.kind}\\), ${second.id} \\(${second.kind}\\)`))
      assert.match(text.stderr, new RegExp(`next: .*pmkit issues link ${a} ${b} --kind blocks --remove`))
      const body = JSON.parse(run(root, ['issues', 'delete', a, '--json', ...flags]).stdout)
      assert.equal(body.error.code, 'CONFLICT')
      assert.deepEqual(body.error.references, [first, second])
    }
    assert.equal(hashTree(root), before)
  })
})

test('an issue file that does not parse refuses and the JSON lists it under problems', () => {
  withRepo({}, (root, [a, b]) => {
    fs.writeFileSync(path.join(root, '.issues/issues', b, 'issue.md'), '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> z\n')
    const body = JSON.parse(run(root, ['issues', 'delete', a, '--json']).stdout)
    assert.equal(body.error.code, 'INVALID_INPUT')
    assert.deepEqual(body.error.problems.map((problem) => problem.id), [b])
    assert.equal(fs.existsSync(path.join(root, '.issues/issues', a)), true)
  })
})

test('with auto_commit the commit holds the removal and the tree is clean', () => {
  withRepo({ autoCommit: true }, (root, [a]) => {
    const count = () => Number(git(root, 'rev-list', '--count', 'HEAD').stdout.trim())
    const before = count()
    assert.equal(run(root, ['issues', 'delete', a]).status, 0)
    assert.equal(count(), before + 1)
    assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), `pmkit: issues delete ${a}`)
    const files = git(root, 'show', '--name-status', '--format=', 'HEAD').stdout.trim().split('\n')
    assert.ok(files.every((line) => line.startsWith('D\t') && line.includes(`.issues/issues/${a}/`)), files.join('\n'))
    assert.ok(files.length >= 2)
    assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all').stdout.trim(), '')
  })
})

test('a dry run and a refusal commit nothing under auto_commit', () => {
  withRepo({ autoCommit: true }, (root, [a, b]) => {
    json(root, ['issues', 'link', a, b, '--kind', 'blocks'])
    const head = git(root, 'rev-parse', 'HEAD').stdout
    run(root, ['issues', 'delete', a])
    run(root, ['issues', 'delete', b, '--dry-run'])
    assert.equal(git(root, 'rev-parse', 'HEAD').stdout, head)
  })
})

test('delete takes exactly one id', () => {
  withRepo({}, (root) => {
    assert.equal(run(root, ['issues', 'delete']).status, 2)
    assert.equal(run(root, ['issues', 'delete', 'A', 'B']).status, 2)
  })
})

test('the preview lists the files of the repository that cite the ID, with their lines, and drops them from unchecked', () => {
  withRepo({}, (root, [a]) => {
    fs.mkdirSync(path.join(root, 'docs'))
    fs.writeFileSync(path.join(root, 'docs/note.md'), `See ${a} for the why.\n`)
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'src/x.mjs'), `// nothing\n// TODO(${a}): later\n// ${a}9 is another issue\n`)
    git(root, 'add', 'docs/note.md')
    const before = hashTree(root)
    const data = json(root, ['issues', 'delete', a, '--dry-run'])
    assert.deepEqual(data.files, [{ path: 'docs/note.md', lines: [1] }, { path: 'src/x.mjs', lines: [2] }])
    assert.ok(!data.unchecked.includes('code comments, documents and docs/'), data.unchecked.join('; '))
    const text = run(root, ['issues', 'delete', a, '--dry-run']).stdout
    assert.ok(text.includes('docs/note.md:1'), text)
    assert.ok(text.includes('src/x.mjs:2'), text)
    assert.equal(hashTree(root), before)
  })
})

test('the scan reads the documents, epics and sprints of the tracker, and leaves out only the issue folders', () => {
  withRepo({}, (root, [a]) => {
    fs.mkdirSync(path.join(root, '.issues/docs/adr'), { recursive: true })
    fs.writeFileSync(path.join(root, '.issues/docs/adr/0009.md'), `Decision depends on ${a}.\n`)
    const data = json(root, ['issues', 'delete', a, '--dry-run'])
    assert.deepEqual(data.files, [{ path: '.issues/docs/adr/0009.md', lines: [1] }])
    assert.deepEqual(data.unchecked, [])
  })
})

test("the user's git color settings do not empty the scan", () => {
  withRepo({}, (root, [a]) => {
    fs.writeFileSync(path.join(root, 'notes.md'), `see ${a}\n`)
    for (const [key, value] of [['color.ui', 'always'], ['color.grep', 'always']]) {
      git(root, 'config', key, value)
      const data = json(root, ['issues', 'delete', a, '--dry-run'])
      assert.deepEqual(data.files, [{ path: 'notes.md', lines: [1] }], key)
      assert.deepEqual(data.unchecked, [], key)
    }
  })
})

test('a repository with no file that cites the ID has an empty files list', () => {
  withRepo({}, (root, [a]) => {
    const data = json(root, ['issues', 'delete', a, '--dry-run'])
    assert.deepEqual(data.files, [])
    assert.deepEqual(data.unchecked, [])
  })
})

test('when git grep cannot run, the files stay unchecked with the reason and are never an empty answer', () => {
  withRepo({}, (root, [a]) => {
    fs.rmSync(path.join(root, '.git'), { recursive: true, force: true })
    const data = json(root, ['issues', 'delete', a, '--dry-run'])
    assert.deepEqual(data.files, [])
    assert.equal(data.unchecked.length, 1)
    // pmkit's own words, not git's fatal text, which changes with the git version.
    assert.equal(data.unchecked[0], 'code comments, documents and docs/ (git grep failed: not a git repository)')
    assert.match(run(root, ['issues', 'delete', a, '--dry-run']).stdout, /not checked: code comments, documents and docs\/ \(git grep failed/)
  })
})

test('issues restore on the Local tracker answers NOT_SUPPORTED with the git commands, and writes nothing', () => {
  withRepo({}, (root, [a]) => {
    json(root, ['issues', 'delete', a])
    const before = hashTree(root)
    const result = run(root, ['issues', 'restore', a, '--json'])
    assert.equal(result.status, 2, result.stdout)
    const { error } = JSON.parse(result.stdout)
    assert.equal(error.code, 'NOT_SUPPORTED')
    assert.match(error.nextStep, new RegExp(`git checkout <commit>\\^ -- ':\\(top\\)\\.issues/issues/${a}' brings the folder back`))
    assert.equal(run(root, ['issues', 'restore', a, '--dry-run', '--json']).status, 2)
    assert.equal(run(root, ['issues', 'restore']).status, 2)
    assert.equal(hashTree(root), before)
    // The command it names works from a subfolder too.
    const sub = path.join(root, 'src')
    fs.mkdirSync(sub)
    const checkout = error.nextStep.match(/^git checkout HEAD -- '([^']+)'/)[1]
    assert.equal(git(sub, 'checkout', 'HEAD', '--', checkout).status, 0)
    assert.ok(fs.existsSync(path.join(root, '.issues/issues', a, 'issue.md')))
  })
})

test('a delete of an ID with ../ exits 2 and writes nothing', () => {
  withRepo({}, (root, [a]) => {
    const before = hashTree(root)
    for (const id of [`../${a}`, '../../etc']) {
      const result = run(root, ['issues', 'delete', id, '--json'])
      assert.equal(result.status, 2, result.stdout)
      assert.equal(JSON.parse(result.stdout).error.code, 'NOT_FOUND')
    }
    assert.equal(hashTree(root), before)
  })
})
