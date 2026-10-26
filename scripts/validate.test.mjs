import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { TRACKERS, unsupportedTracker } from './lib/config.mjs'
import { validateRepo } from './lib/validate.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

const brief = (result) => result.problems.map(({ path: file, code }) => `${code} ${file}`).sort()

test('broken fixture returns exactly one problem of each kind, at the right path', () => {
  const root = makeRepo('broken')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), [
    'config .issues/config.yaml',
    'conflict .issues/issues/ISS-1CNF/issue.md',
    'cycle .issues/issues/ISS-5CYA/issue.md',
    'drift .issues/issues/ISS-7DFT/issue.md',
    'events .issues/issues/ISS-6EVT/events.jsonl',
    'frontmatter .issues/issues/ISS-2FMT/issue.md',
    'id .issues/issues/ISS-8DDM/issue.md',
    'reference .issues/issues/ISS-4REF/issue.md',
    'sprint .issues/sprints/2026-10-12.yaml',
    'value .issues/issues/ISS-3VAZ/issue.md',
  ])
  assert.deepEqual(result.checked, { issues: 9, epics: 0, sprints: 1, milestones: 0, comments: 0 })
  const cycle = result.problems.find((problem) => problem.code === 'cycle')
  assert.match(cycle.message, /ISS-5CYA.*ISS-5CYB.*ISS-5CYA/)
})

test('team fixture minus its conflicted issue has no problems', () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues', 'issues', 'ISS-3Q6T'), { recursive: true })
  const result = validateRepo(root)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.checked, { issues: 12, epics: 1, sprints: 2, milestones: 0, comments: 0 })
})

test('team fixture reports only its conflicted issue', () => {
  const result = validateRepo(makeRepo('team'))
  assert.deepEqual(brief(result), ['conflict .issues/issues/ISS-3Q6T/issue.md'])
})

const pmkitFile = (root) => path.join(root, '.pmkit', 'config.yaml')
const setPmkit = (root, text) => fs.writeFileSync(pmkitFile(root), text)
const editPmkit = (root, from, to) => setPmkit(root, fs.readFileSync(pmkitFile(root), 'utf8').replace(from, to))
const breakPmkit = (root) => {
  editPmkit(root, 'system: none', 'system: gitlab')
  editPmkit(root, 'confirm: single_writes', 'confirm: sometimes')
}

test('validateRepo writes nothing', () => {
  for (const name of ['broken', 'team']) {
    const root = makeRepo(name)
    const before = hashTree(root)
    validateRepo(root)
    assert.equal(hashTree(root), before)
  }
  const root = makeRepo('basic')
  breakPmkit(root)
  const before = hashTree(root)
  validateRepo(root)
  assert.equal(hashTree(root), before)
  const linear = makeRepo('basic')
  editPmkit(linear, 'system: local', 'system: linear')
  const linearBefore = hashTree(linear)
  validateRepo(linear)
  assert.equal(hashTree(linear), linearBefore)
})

function writeIssue(root, id, extra = '') {
  const dir = path.join(root, '.issues', 'issues', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'issue.md'), `---\nid: ${id}\ntitle: T\ntype: task\nstatus: todo\npriority: medium\n${extra}---\n`)
}

test('a parent loop is reported once', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA', 'parent: ISS-1BBB\n')
  writeIssue(root, 'ISS-1BBB', 'parent: ISS-1CCC\n')
  writeIssue(root, 'ISS-1CCC', 'parent: ISS-1AAA\n')
  writeIssue(root, 'ISS-1DDD', 'parent: ISS-1AAA\n')
  const cycles = validateRepo(root).problems.filter((problem) => problem.code === 'cycle')
  assert.equal(cycles.length, 1)
  assert.match(cycles[0].message, /parent/)
})

function writeMilestone(root, name, text = '---\nname: M\n---\n') {
  const dir = path.join(root, '.issues', 'milestones')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text)
}

test('a milestone is checked only when a milestones folder exists', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA', 'milestone: v1\n')
  assert.deepEqual(validateRepo(root).problems, [])
  writeMilestone(root, 'v2.md')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['reference .issues/issues/ISS-1AAA/issue.md'])
  assert.equal(result.problems[0].message, 'milestone v1 does not exist')
})

test('an empty milestones folder, a subfolder or a .yaml file turns no check on', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA', 'milestone: v1\n')
  fs.mkdirSync(path.join(root, '.issues', 'milestones'), { recursive: true })
  assert.deepEqual(validateRepo(root).problems, [])
  fs.mkdirSync(path.join(root, '.issues', 'milestones', 'v2'))
  writeMilestone(root, 'v3.yaml', 'name: v3\n')
  const result = validateRepo(root)
  assert.deepEqual(result.problems, [])
  assert.equal(result.checked.milestones, 0)
})

test('a .yaml stem is not a milestone once milestone files exist', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA', 'milestone: v1\n')
  writeIssue(root, 'ISS-1BBB', 'milestone: v2\n')
  writeMilestone(root, 'v1.yaml', 'name: v1\n')
  writeMilestone(root, 'v2.md')
  assert.deepEqual(brief(validateRepo(root)), ['reference .issues/issues/ISS-1AAA/issue.md'])
})

test('an epic whose milestone has no file is a reference problem', () => {
  const root = makeRepo('basic')
  const dir = path.join(root, '.issues', 'epics', 'EPC-1AAA')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'epic.md'), '---\nid: EPC-1AAA\ntitle: E\nstatus: backlog\nmilestone: v1\n---\n')
  assert.deepEqual(validateRepo(root).problems, [])
  writeMilestone(root, 'v2.md')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['reference .issues/epics/EPC-1AAA/epic.md'])
  assert.equal(result.problems[0].message, 'milestone v1 does not exist')
  fs.renameSync(path.join(root, '.issues', 'milestones', 'v2.md'), path.join(root, '.issues', 'milestones', 'v1.md'))
  assert.deepEqual(validateRepo(root).problems, [])
})

test('a milestone file that does not parse, or whose name breaks the id rule, is a milestone problem', () => {
  const root = makeRepo('basic')
  writeMilestone(root, 'good.md')
  writeMilestone(root, 'bad-due.md', '---\ndue: 2026-13-40\n---\n')
  writeMilestone(root, 'Q4 2026.md')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['milestone .issues/milestones/Q4 2026.md', 'milestone .issues/milestones/bad-due.md'])
  assert.match(result.problems.find((p) => p.path.endsWith('bad-due.md')).message, /due/)
  assert.match(result.problems.find((p) => p.path.endsWith('Q4 2026.md')).message, /Q4 2026/)
  assert.equal(result.checked.milestones, 3)
})

test('a milestone file with conflict markers is one conflict problem, as for epics and sprints', () => {
  const root = makeRepo('basic')
  writeMilestone(root, 'v1.md', '---\n<<<<<<< HEAD\nname: A\n=======\nname: B\n>>>>>>> other\n---\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['conflict .issues/milestones/v1.md'])
  assert.equal(result.checked.milestones, 1)
})

test('two folders with the same normalized id are one id problem', () => {
  const root = makeRepo('basic')
  writeIssue(root, 'ISS-1AAA')
  writeIssue(root, 'iss-1aaa')
  const ids = validateRepo(root).problems.filter((problem) => problem.code === 'id')
  assert.ok(ids.some((problem) => /same id/.test(problem.message)))
})

test('a config.yaml with conflict markers is one conflict problem and does not throw', () => {
  const root = makeRepo('broken')
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), 'version: 1\n<<<<<<< HEAD\ndefault_status: todo\n=======\ndefault_status: backlog\n>>>>>>> feature/x\n')
  assert.deepEqual(brief(validateRepo(root)), ['conflict .issues/config.yaml'])
})

test('an unparseable config.yaml is one config problem and does not throw', () => {
  const root = makeRepo('team')
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), 'version: 1\nthis line has no colon\n')
  assert.deepEqual(brief(validateRepo(root)), ['config .issues/config.yaml'])
})

test('conflict markers inside a fenced code block are not a conflict problem', () => {
  const root = makeRepo('team')
  fs.rmSync(path.join(root, '.issues', 'issues', 'ISS-3Q6T'), { recursive: true })
  writeIssue(root, 'ISS-9FEN', '')
  const file = path.join(root, '.issues', 'issues', 'ISS-9FEN', 'issue.md')
  fs.appendFileSync(file, '\n## Description\n\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n```\n')
  assert.deepEqual(brief(validateRepo(root)).filter((line) => line.startsWith('conflict')), [])
})

test('a bad .pmkit/config.yaml is reported with its path', () => {
  const root = makeRepo('basic')
  breakPmkit(root)
  assert.deepEqual(validateRepo(root).problems, [
    { path: '.pmkit/config.yaml', code: 'config', message: 'git_host.system must be github or none' },
    { path: '.pmkit/config.yaml', code: 'config', message: 'write_policy.confirm must be one of all_writes, single_writes, none' },
  ])
})

test('problems of both config files are listed, sorted by path', () => {
  const root = makeRepo('broken')
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), 'version: 1\nthis line has no colon\n')
  breakPmkit(root)
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['config .issues/config.yaml', 'config .pmkit/config.yaml', 'config .pmkit/config.yaml'])
  assert.equal(result.problems[0].path, '.issues/config.yaml')
})

test('an unparseable .pmkit/config.yaml is one config problem and does not throw', () => {
  const root = makeRepo('basic')
  setPmkit(root, 'version: 1\nthis line has no colon\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['config .pmkit/config.yaml'])
  assert.match(result.problems[0].message, /^config\.yaml does not parse:/)
})

test('.pmkit/config.yaml with conflict markers is one conflict problem', () => {
  const root = makeRepo('basic')
  setPmkit(root, 'version: 1\n<<<<<<< HEAD\ngit_host:\n=======\nx: 1\n>>>>>>> b\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['conflict .pmkit/config.yaml'])
  assert.equal(result.problems[0].message, 'the file contains git conflict markers')
})

test('tracker.system trello and a numeric tracker.path are problems, not throws', () => {
  const trello = makeRepo('basic')
  editPmkit(trello, 'system: local', 'system: trello')
  const first = validateRepo(trello).problems
  assert.equal(first.length, 1)
  assert.equal(first[0].path, '.pmkit/config.yaml')
  assert.match(first[0].message, /^tracker\.system must be one of/)
  const numeric = makeRepo('basic')
  editPmkit(numeric, 'path: .issues', 'path: 7')
  const second = validateRepo(numeric).problems
  assert.equal(second.length, 1)
  assert.equal(second[0].path, '.pmkit/config.yaml')
  assert.equal(second[0].message, 'tracker.path must be a string')
})

test('a .pmkit/config.yaml that loadConfig rejects is not blamed on .issues/config.yaml', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: local', 'system: 5')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['config .pmkit/config.yaml'])
  assert.match(result.problems[0].message, /^tracker\.system must be one of/)
})

test('a broken tracker config under a folder named .pmkit is still listed', () => {
  const root = makeRepo('basic')
  fs.mkdirSync(path.join(root, 'work'))
  fs.renameSync(path.join(root, '.issues'), path.join(root, 'work', '.pmkit'))
  editPmkit(root, 'path: .issues', 'path: work/.pmkit')
  fs.writeFileSync(path.join(root, 'work', '.pmkit', 'config.yaml'), 'version: 1\nthis line has no colon\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result), ['config work/.pmkit/config.yaml'])
  assert.match(result.problems[0].message, /^work\/\.pmkit\/config\.yaml is not valid YAML:/)
})

test('an empty or non-map .pmkit/config.yaml gives config problems and does not throw', () => {
  for (const text of ['', '- a\n- b\n']) {
    const root = makeRepo('basic')
    setPmkit(root, text)
    const result = validateRepo(root)
    assert.ok(result.problems.length > 0)
    assert.ok(result.problems.every((problem) => problem.path === '.pmkit/config.yaml' && problem.code === 'config'))
  }
})

test('a missing .pmkit/config.yaml still throws NOT_CONFIGURED', () => {
  const root = makeRepo('basic')
  fs.rmSync(pmkitFile(root))
  assert.throws(() => validateRepo(root), { code: 'NOT_CONFIGURED' })
})

test('a bad .pmkit/config.yaml with .issues/config.yaml missing still throws NOT_CONFIGURED', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: none', 'system: gitlab')
  fs.rmSync(path.join(root, '.issues', 'config.yaml'))
  assert.throws(() => validateRepo(root), { code: 'NOT_CONFIGURED' })
})

const MSG = 'tracker.system "linear" is not supported yet, set it to local'
const messages = (result) => result.problems.map((problem) => problem.message)

test('tracker.system linear alone is one config problem, not a throw', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: local', 'system: linear')
  let result
  assert.doesNotThrow(() => {
    result = validateRepo(root)
  })
  assert.deepEqual(brief(result), ['config .pmkit/config.yaml'])
  assert.equal(result.problems[0].message, MSG)
  assert.deepEqual(result.checked, { issues: 0, epics: 0, sprints: 0, milestones: 0, comments: 0 })
  assert.ok(MSG.startsWith(unsupportedTracker('linear').message))
})

test('every known tracker except local is listed', () => {
  for (const name of TRACKERS.filter((tracker) => tracker !== 'local')) {
    const root = makeRepo('basic')
    editPmkit(root, 'system: local', `system: ${name}`)
    assert.deepEqual(messages(validateRepo(root)), [`tracker.system "${name}" is not supported yet, set it to local`], name)
  }
})

test('linear and git_host.system gitlab list both problems', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: local', 'system: linear')
  editPmkit(root, 'system: none', 'system: gitlab')
  assert.deepEqual(messages(validateRepo(root)), ['git_host.system must be github or none', MSG])
})

test('linear and breakPmkit list three problems', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: local', 'system: linear')
  breakPmkit(root)
  const result = validateRepo(root)
  assert.ok(result.problems.every((problem) => problem.path === '.pmkit/config.yaml' && problem.code === 'config'))
  assert.deepEqual(messages(result), [
    'git_host.system must be github or none',
    'write_policy.confirm must be one of all_writes, single_writes, none',
    MSG,
  ])
})

test('linear with a broken .issues/config.yaml lists only the tracker problem', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: local', 'system: linear')
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), 'version: 1\nthis line has no colon\n')
  assert.deepEqual(brief(validateRepo(root)), ['config .pmkit/config.yaml'])
})

test('tracker.system local with another bad key lists no tracker problem', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'system: none', 'system: gitlab')
  assert.deepEqual(messages(validateRepo(root)), ['git_host.system must be github or none'])
})

test('an empty .pmkit/config.yaml gets no tracker problem', () => {
  const root = makeRepo('basic')
  setPmkit(root, '')
  assert.deepEqual(messages(validateRepo(root)), [
    'version must be 1',
    'tracker.system must be one of local, linear, jira, github, gitlab, azure-devops',
    'git_host.system must be github or none',
    'write_policy.confirm must be one of all_writes, single_writes, none',
  ])
})

test('tracker as a string gets no tracker problem', () => {
  const root = makeRepo('basic')
  editPmkit(root, 'tracker:\n  system: local\n  path: .issues\n', 'tracker: linear\n')
  assert.deepEqual(messages(validateRepo(root)), ['tracker.system must be one of local, linear, jira, github, gitlab, azure-devops'])
})

test('every fixture has no .pmkit/config.yaml problem', () => {
  for (const name of ['basic', 'broken', 'team', 'no-sprints', 'messy-merge']) {
    const problems = validateRepo(makeRepo(name)).problems.filter((problem) => problem.path === '.pmkit/config.yaml')
    assert.deepEqual(problems, [], name)
  }
})
