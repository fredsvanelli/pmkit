import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { fakeGh } from './fake-gh.mjs'
import { COMMANDS } from './pmkit.mjs'
import { NOW, runPmkit } from './golden-helpers.mjs'
import {
  scenarioName, snapshotFile, parseCommandFile, callKey, unknownFlags,
  matchEntry, coverageProblems, pointProblems, orderProblems, compareScenarios, staleSnapshots,
  readTree, treeChanges, formatSnapshot, makeRepoView, runScenario, traceFromLog, stopProblems, expectUntilSaved,
} from './scenario-helpers.mjs'
import moveScenario from './__scenarios__/issues-move.mjs'
import { tempDir } from './test-helpers.mjs'

const CLI_NAMES = COMMANDS.map((c) => c.name)
const cli = (name) => COMMANDS.find((c) => c.name === name)
const call = (rest) => `\`node "\${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" ${rest}\``
const parse = (text) => parseCommandFile(text, CLI_NAMES)
const stepsOf = (text) => parse(text).calls.map((c) => `${c.section}|${c.step}|${c.command}`)

test('scenarioName turns a command path into a file name', () => {
  assert.equal(scenarioName('issues/create'), 'issues-create')
  assert.equal(scenarioName('issues/create.md'), 'issues-create')
  assert.equal(scenarioName('help'), 'help')
})

test('snapshotFile adds the index only when a module has several scenarios', () => {
  assert.equal(snapshotFile('issues-move', 0, 1), 'issues-move.after.txt')
  assert.equal(snapshotFile('setup', 1, 2), 'setup.1.after.txt')
})

test('snapshotFile numbers the entries of an array from 0', () => {
  assert.equal(snapshotFile('setup', 0, 2), 'setup.0.after.txt')
})

test('parseCommandFile gives step ids to items, nested items, bullets and headings', () => {
  const text = [
    '# Title',
    '',
    '## Parameters',
    '',
    `Use ${call('epic list --json')} to list epics.`,
    '',
    '## Steps',
    '',
    `1. Run ${call('issues get <id> --json')}.`,
    `2. Run ${call('discover --json')}.`,
    '3. Resolve:',
    '   1. Read the file.',
    `   2. Run ${call('validate --json')} again.`,
    `      - For a status, ${call('issues move <id> <category> --status <name> --dry-run --json')}.`,
    `   - A sibling bullet, ${call('whoami --json')}.`,
    '',
    '### 4. Update',
    '',
    `2. Run ${call('migrate --dry-run --json')}.`,
    '',
    '### First run',
    '',
    '   ```',
    '   1. not an item',
    '   ```',
    `6. Preview with ${call('init --prefix <P> --dry-run --json')}.`,
    '',
    '### Existing config',
    '',
    '3. Something.',
    `   - ${call('capabilities --json')}`,
    '',
    '## If something is missing',
    '',
    `- No branch: run ${call('issues update <id> --branch <b> --dry-run --json')}.`,
  ].join('\n')
  assert.deepEqual(stepsOf(text), [
    'other||epic list',
    'steps|1|issues get',
    'steps|2|discover',
    'steps|3.2|validate',
    'steps|3.2|issues move',
    'steps|3|whoami',
    'steps|4|migrate',
    'steps|First run 6|init',
    'steps|Existing config 3|capabilities',
    'missing|missing|issues update',
  ])
})

test('parseCommandFile keeps every call of a line in its step', () => {
  const text = ['## Steps', '', `9. Run ${call('validate --json')}, ${call('discover --json')} and ${call('capabilities --json')}.`].join('\n')
  assert.deepEqual(stepsOf(text), ['steps|9|validate', 'steps|9|discover', 'steps|9|capabilities'])
})

test('parseCommandFile reads command, flags, optional flags and placeholders', () => {
  const text = [
    '## Steps',
    '',
    `1. ${call('issues link <from> <to> --kind <k> [--remove] --dry-run --json')}`,
    `2. ${call('issues list <flags> --json')}`,
    '3. Run `node "<installPath>/scripts/pmkit.mjs" migrate --json`.',
    `4. ${call('issues create --title "<title>" <fields> --dry-run --json')}`,
    `5. ${call('issues link <from> <to> --kind blocks')}`,
  ].join('\n')
  const [link, list, migrate, create, noJson] = parse(text).calls
  assert.equal(link.command, 'issues link')
  assert.deepEqual(link.flags, ['kind', 'remove', 'dry-run', 'json'])
  assert.deepEqual(link.optional, ['remove'])
  assert.equal(link.dryRun, true)
  assert.equal(link.anyFlags, false)
  assert.equal(link.endsWithJson, true)
  assert.equal(link.text, 'issues link <from> <to> --kind <k> [--remove] --dry-run --json')
  assert.equal(list.anyFlags, true)
  assert.equal(list.dryRun, false)
  assert.equal(migrate.command, 'migrate')
  assert.equal(migrate.step, '3')
  assert.equal(create.anyFlags, true)
  assert.equal(noJson.endsWithJson, false)
})

test('parseCommandFile keys confirmation points by label', () => {
  const text = [
    '## Confirmation points',
    '',
    '- Step 5: the status change.',
    '- Recording the current branch on the issue, when `pr open` finds no branch: a single write that asks once.',
    '- First run: the one summary',
    '- Step 3 is a choice of input, not a confirmation.',
    '',
    'None for the summary: it only reads.',
    '',
    '## Output',
    '',
    '- Lead: with what changed.',
  ].join('\n')
  assert.deepEqual(parse(text).points, [
    'Step 5',
    'Recording the current branch on the issue, when `pr open` finds no branch',
    'First run',
  ])
})

test('parseCommandFile reads a note bullet with ": " mid-sentence as a point', () => {
  const text = ['## Confirmation points', '', '- The rest is read-only: nothing to ask.'].join('\n')
  assert.deepEqual(parse(text).points, ['The rest is read-only'])
})

test('parseCommandFile ignores ": " inside backticks when it looks for the label', () => {
  const text = ['## Confirmation points', '', '- `write_policy.confirm: none` skips the question.', '- Step 4: the `a: b` change.'].join('\n')
  assert.deepEqual(parse(text).points, ['Step 4'])
})

test('callKey joins the step id and the CLI command', () => {
  assert.equal(callKey({ step: 'First run 9', command: 'validate' }), 'First run 9 validate')
})

test('unknownFlags accepts json, root, dry-run and as by kind', () => {
  const flags = (command, list) => ({ command, flags: list })
  assert.deepEqual(unknownFlags(flags('issues move', ['status', 'as', 'dry-run', 'json', 'root']), cli('issues move')), [])
  assert.deepEqual(unknownFlags(flags('init', ['prefix', 'as', 'dry-run', 'json']), cli('init')), ['as'])
  assert.deepEqual(unknownFlags(flags('issues get', ['comments', 'dry-run']), cli('issues get')), ['dry-run'])
  assert.deepEqual(unknownFlags(flags('issues list', ['nope', 'archived']), cli('issues list')), ['nope'])
})

const STEP_FILE = [
  '## Steps',
  '',
  `1. ${call('issues get <id> --json')}`,
  `4. ${call('issues move <id> <category> [--status <name>] --dry-run --json')}`,
  `5. ${call('issues list <flags> --json')}`,
  `7. ${call('cycle close <id> --dry-run --json')} then ${call('cycle close <id> --json')}`,
].join('\n')

test('matchEntry ties a dry run only to a call with --dry-run', () => {
  const { calls } = parse(STEP_FILE)
  assert.deepEqual(matchEntry({ step: '4', kind: 'dryRun', args: ['issues', 'move', 'A', 'done'] }, calls, CLI_NAMES), { key: '4 issues move', viaDryRun: false })
  assert.match(matchEntry({ step: '1', kind: 'dryRun', args: ['issues', 'get', 'A'] }, calls, CLI_NAMES).error, /step 1.*--dry-run/)
})

test('matchEntry prefers a write call without --dry-run, else goes via the dry run', () => {
  const { calls } = parse(STEP_FILE)
  assert.deepEqual(matchEntry({ step: '7', kind: 'write', args: ['cycle', 'close', 'S-1'] }, calls, CLI_NAMES), { key: '7 cycle close', viaDryRun: false })
  assert.deepEqual(matchEntry({ step: '4', kind: 'write', args: ['issues', 'move', 'A', 'done', '--status', 'Done'] }, calls, CLI_NAMES), { key: '4 issues move', viaDryRun: true })
})

test('matchEntry rejects flags the call lacks, except against a placeholder', () => {
  const { calls } = parse(STEP_FILE)
  assert.match(matchEntry({ step: '4', kind: 'dryRun', args: ['issues', 'move', 'A', 'done', '--as', 'ana'] }, calls, CLI_NAMES).error, /--as/)
  assert.deepEqual(matchEntry({ step: '5', kind: 'read', args: ['issues', 'list', '--type', 'bug', '--sprint', 'current'] }, calls, CLI_NAMES), { key: '5 issues list', viaDryRun: false })
})

test('matchEntry fails when the step has no call of that command', () => {
  const { calls } = parse(STEP_FILE)
  assert.match(matchEntry({ step: '2', kind: 'read', args: ['issues', 'get', 'A'] }, calls, CLI_NAMES).error, /step 2 has no call of `issues get`/)
  assert.match(matchEntry({ step: '1', kind: 'read', args: ['discover'] }, calls, CLI_NAMES).error, /step 1 has no call of `discover`/)
})

test('matchEntry ignores calls outside the steps and missing sections', () => {
  const { calls } = parse(['## Parameters', '', `1. ${call('epic list --json')}`].join('\n'))
  assert.match(matchEntry({ step: '1', kind: 'read', args: ['epic', 'list'] }, calls, CLI_NAMES).error, /no call/)
})

test('matchEntry rejects --json and --dry-run in the entry args', () => {
  const { calls } = parse(STEP_FILE)
  assert.match(matchEntry({ step: '1', kind: 'read', args: ['issues', 'get', 'A', '--json'] }, calls, CLI_NAMES).error, /--json/)
})

test('coverageProblems names unused keys, stale skips and empty reasons', () => {
  const { calls } = parse(STEP_FILE)
  assert.deepEqual(coverageProblems(calls, new Set(['1 issues get', '4 issues move', '7 cycle close']), { '5 issues list': 'not asked' }), [])
  const problems = coverageProblems(calls, new Set(['1 issues get', '7 cycle close']), { '5 issues list': ' ', '9 validate': 'gone' })
  assert.equal(problems.length, 3)
  assert.match(problems[0], /`4 issues move`.*not used/)
  assert.match(problems[1], /skip `5 issues list`.*reason/)
  assert.match(problems[2], /skip `9 validate`.*matches no call/)
})

test('coverageProblems ignores calls in other sections', () => {
  const { calls } = parse(['## Parameters', '', `1. ${call('epic list --json')}`].join('\n'))
  assert.deepEqual(coverageProblems(calls, new Set(), {}), [])
})

test('pointProblems ties the file keys to confirms and notHit', () => {
  const points = ['Step 2', 'Step 5', 'Step 7']
  assert.deepEqual(pointProblems(points, ['Step 2', 'Step 5', 'Step 5'], { 'Step 7': 'no commits' }), [])
  assert.match(pointProblems(points, ['Step 2', 'Step 5'], {})[0], /`Step 7`.*neither confirmed nor in notHit/)
  assert.match(pointProblems(points, ['Step 2', 'Step 5', 'Step 7'], { 'Step 9': 'x' })[0], /notHit `Step 9`.*not a confirmation point/)
  assert.match(pointProblems(points, ['Step 2', 'Step 5', 'Step 7', 'Step 8'], {})[0], /confirm `Step 8`.*not a confirmation point/)
  assert.match(pointProblems(points, ['Step 2', 'Step 5'], { 'Step 7': '' })[0], /notHit `Step 7`.*reason/)
  assert.match(pointProblems(points, ['Step 2', 'Step 5', 'Step 7'], { 'Step 7': 'x' })[0], /notHit `Step 7`.*also confirmed/)
})

const W = (args, viaDryRun = true) => ({ kind: 'write', step: '4', args, key: '4 issues move', viaDryRun })
const D = (args) => ({ kind: 'dryRun', step: '4', args })
const C = { kind: 'confirm', key: 'Step 5' }
const MOVE = ['issues', 'move', 'A', 'done']

test('orderProblems requires a confirm before each write and edit', () => {
  assert.deepEqual(orderProblems([D(MOVE), C, W(MOVE)]), [])
  assert.match(orderProblems([D(MOVE), W(MOVE), C])[0], /write \[step 4\] issues move A done.*before any confirm/)
  assert.match(orderProblems([{ kind: 'edit', step: '2.4' }, C])[0], /edit \[step 2\.4\].*before any confirm/)
})

test('orderProblems requires a matching dry run before a write via dry run', () => {
  assert.match(orderProblems([C, W(MOVE)])[0], /no earlier dry run/)
  assert.deepEqual(orderProblems([C, D(MOVE), W(MOVE)]), [])
  assert.deepEqual(orderProblems([C, W(MOVE, false)]), [])
  assert.match(orderProblems([C, W(MOVE), D(MOVE)])[0], /no earlier dry run/)
})

test('orderProblems does not let a dry run with other args cover a write', () => {
  const est = (n) => ['issues', 'update', 'A', '--estimate', n]
  assert.match(orderProblems([D(est('3')), C, W(est('5'))])[0], /--estimate 5.*no earlier dry run/)
})

test('parseCommandFile counts a flag named only in the prose of a step as a flag of that step', () => {
  const text = [
    '## Steps',
    '',
    `1. Run ${call('issues update <id> --priority <value> --dry-run --json')} or \`--type <value>\`.`,
    `2. Run ${call('init --update --dry-run --json')}. Add \`--git-host\` only when asked.`,
  ].join('\n')
  const [first, second] = parse(text).calls
  assert.deepEqual(first.flags.slice(-1), ['type'])
  assert.ok(second.flags.includes('git-host'))
  assert.ok(second.optional.includes('git-host'))
})

test('compareScenarios reports missing and extra names', () => {
  assert.deepEqual(compareScenarios(['a', 'b', 'c'], ['b', 'c', 'x']), { missing: ['a'], extra: ['x'] })
  assert.deepEqual(compareScenarios(['a', 'b'], ['a', 'b']), { missing: [], extra: [] })
})

test('staleSnapshots returns snapshots with no entry and leaves _inputs and modules', () => {
  const files = ['a.mjs', 'a.after.txt', 'b.0.after.txt', 'b.1.after.txt', 'gone.after.txt', '_inputs']
  assert.deepEqual(staleSnapshots(files, ['a.after.txt', 'b.0.after.txt']), ['b.1.after.txt', 'gone.after.txt'])
})

test('parseCommandFile attaches a prose flag before the first call of a step to the next call of that step', () => {
  const text = [
    '## Steps',
    '',
    `1. When the user gave no \`--status\`, run ${call('discover --json')}.`,
    `2. Run ${call('issues get <id> --json')}.`,
  ].join('\n')
  const parsed = parse(text)
  assert.ok(parsed.calls[0].flags.includes('status'))
  assert.ok(!parsed.calls[1].flags.includes('status'))
  assert.deepEqual(parsed.looseFlags, [])
})

test('parseCommandFile returns a prose flag that has no call in its step as loose', () => {
  const text = ['## Steps', '', '1. Ask for \`--bogus\`.', `2. Run ${call('discover --json')}.`].join('\n')
  assert.deepEqual(parse(text).looseFlags, [{ step: '1', section: 'steps', flag: 'bogus' }])
})

test('orderProblems does not let a dry run that ended in an expected error cover a write', () => {
  const failed = { ...D(MOVE), expectError: 'INVALID_INPUT' }
  assert.match(orderProblems([failed, C, W(MOVE)])[0], /no earlier dry run/)
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, '__fixtures__')
const INPUTS = path.join(HERE, '__scenarios__', '_inputs')
const MOVE_FILE = parse(fs.readFileSync(path.join(HERE, '..', 'commands', 'issues', 'move.md'), 'utf8'))
const scratchDir = () => tempDir('pmkit-test-')
const writeFile = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

test('readTree maps posix relative paths to text and skips .git', () => {
  const root = scratchDir()
  try {
    writeFile(root, 'a/b.txt', 'b\n')
    writeFile(root, '.git/HEAD', 'ref\n')
    assert.deepEqual([...readTree(root)], [['a/b.txt', 'b\n']])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('treeChanges lists added, removed and changed files sorted', () => {
  const before = new Map([['b.md', 'one\ntwo\n'], ['c.md', 'gone\n'], ['d.md', 'same\n']])
  const after = new Map([['a.md', 'new\nlines\n'], ['b.md', 'one\nthree\n'], ['d.md', 'same\n']])
  assert.deepEqual(treeChanges(before, after), [
    '--- added a.md',
    '+new',
    '+lines',
    '--- changed b.md',
    '  one',
    '-two',
    '+three',
    '--- removed c.md',
  ])
})

test('treeChanges prints (no file changed)', () => {
  assert.deepEqual(treeChanges(new Map([['a', 'x']]), new Map([['a', 'x']])), ['(no file changed)'])
})

test('formatSnapshot puts the gh calls last only when given', () => {
  const rows = ['$ pmkit help --json  [step 1, read]', 'exit 0']
  assert.equal(formatSnapshot({ rows, changes: ['(no file changed)'], gh: null }), `${rows.join('\n')}\n\n(no file changed)\n`)
  assert.equal(
    formatSnapshot({ rows, changes: ['(no file changed)'], gh: ['pr view x'] }),
    `${rows.join('\n')}\n\n(no file changed)\n--- gh calls\npr view x\n`,
  )
  assert.match(formatSnapshot({ rows, changes: ['(no file changed)'], gh: [] }), /--- gh calls\n\(none\)\n$/)
})

test('formatSnapshot leaves no line ending in whitespace', () => {
  const snapshot = formatSnapshot({ rows: ['exit 0'], changes: ['--- changed a.md', '  ', '-x ', '+x'], gh: ['pr view x '] })
  assert.deepEqual(snapshot.split('\n').filter((line) => /\s$/.test(line)), [])
  assert.equal(snapshot, 'exit 0\n\n--- changed a.md\n\n-x\n+x\n--- gh calls\npr view x\n')
})

test('makeRepoView.newEvents names a deleted event log', () => {
  const root = scratchDir()
  try {
    const log = '.issues/issues/ISS-1/events.jsonl'
    writeFile(root, log, '{"op":"create"}\n')
    writeFile(root, '.issues/issues/ISS-1/issue.md', '---\nid: ISS-1\n---\n')
    const baseline = readTree(root)
    fs.rmSync(path.join(root, log))
    assert.throws(() => makeRepoView(root, baseline, null).newEvents('ISS-1'), /events\.jsonl was deleted/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('makeRepoView.newEvents returns only appended events', () => {
  const root = scratchDir()
  try {
    const log = '.issues/issues/ISS-1/events.jsonl'
    writeFile(root, log, '{"op":"create"}\n')
    writeFile(root, '.issues/epics/EPC-1/events.jsonl', '{"op":"create"}\n')
    const baseline = readTree(root)
    fs.appendFileSync(path.join(root, log), '{"op":"move"}\n{"op":"assign"}\n')
    const repo = makeRepoView(root, baseline, null)
    assert.deepEqual(repo.newEvents('ISS-1'), [{ op: 'move' }, { op: 'assign' }])
    assert.deepEqual(repo.newEvents('EPC-1'), [])
    assert.deepEqual(repo.ghCalls(), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// A scenario on move.md that excuses every call and point it does not reach, so only the rule under test can fail.
const moveOnly = (steps, extra = {}) => ({
  command: 'issues/move',
  fixture: 'team',
  steps,
  skip: { '1 issues get': 'test', '2 issues get': 'test', '3 discover': 'test' },
  notHit: { 'Step 5': 'test' },
  ...extra,
})
const runMove = (scenario, run) =>
  runScenario(scenario, { name: 'issues-move', parsed: MOVE_FILE, cliCommands: COMMANDS, fixturesDir: FIXTURES, inputsDir: INPUTS, run })
const DRY_MOVE = { step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'done'] }

test('runScenario fails a dry run that writes', async () => {
  const writing = async (args, cwd, options) => {
    fs.writeFileSync(path.join(cwd, '.issues', 'x'), 'x')
    return runPmkit(args, cwd, options)
  }
  const { problems } = await runMove(moveOnly([DRY_MOVE], { git: true }), writing)
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^rule 8: dryRun \[step 4\] issues move ISS-2X6D done .*changed/)
})

// Creates the index only when it is missing: the real CLI may have built it on an earlier read, and a dry run
// that overwrote it would be the fake's write, not the CLI's.
const writingCache = async (args, cwd, options) => {
  const index = path.join(cwd, '.issues', '.cache', 'index.json')
  if (!fs.existsSync(index)) {
    fs.mkdirSync(path.dirname(index), { recursive: true })
    fs.writeFileSync(index, '{}')
  }
  return runPmkit(args, cwd, options)
}

test('runScenario lets a read create .issues/.cache/index.json and keeps it out of the snapshot', async () => {
  const read = { step: '1', read: ['issues', 'get', 'ISS-2X6D'] }
  const scenario = moveOnly([read, DRY_MOVE], { skip: { '2 issues get': 'test', '3 discover': 'test' } })
  const { problems, snapshot } = await runMove(scenario, writingCache)
  assert.deepEqual(problems.filter((problem) => problem.startsWith('rule 8')), [])
  assert.ok(!snapshot.includes('.cache'))
})

test('runScenario fails a dry run that creates .issues/.cache/index.json', async () => {
  const { problems } = await runMove(moveOnly([DRY_MOVE]), writingCache)
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^rule 8: dryRun \[step 4\]/)
})

test('runScenario lets a dry run change files under .git', async () => {
  const touchingGit = async (args, cwd, options) => {
    fs.writeFileSync(path.join(cwd, '.git', 'x'), 'x')
    return runPmkit(args, cwd, options)
  }
  const { problems } = await runMove(moveOnly([DRY_MOVE], { git: true }), touchingGit)
  assert.deepEqual(problems, [])
})

test('runScenario matches a write to its dry run on the args without --json and --dry-run', async () => {
  const write = (args) => ({ step: '4', write: args })
  const confirm = { confirm: 'Step 5' }
  const same = await runMove(moveOnly([DRY_MOVE, confirm, write(DRY_MOVE.dryRun)], { notHit: {} }))
  assert.deepEqual(same.problems, [])
  const other = await runMove(moveOnly([DRY_MOVE, confirm, write([...DRY_MOVE.dryRun, '--status', 'done'])], { notHit: {} }))
  assert.equal(other.problems.length, 1, other.problems.join('\n'))
  assert.match(other.problems[0], /^rule 9: .*--status done.*no earlier dry run/)
})

test('runScenario does not let a dry run that failed as expected cover a write', async () => {
  const failing = { step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'finished'], expectError: 'INVALID_INPUT' }
  const { problems, snapshot } = await runMove(moveOnly([failing, { confirm: 'Step 5' }, { step: '4', write: failing.dryRun, expectError: 'INVALID_INPUT' }], { notHit: {} }))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^rule 9: write .*finished.*no earlier dry run/)
  assert.match(snapshot, /exit 2 \(expected INVALID_INPUT\)/)
})

test('runScenario names an entry of no known kind as a runner problem', async () => {
  const { problems, snapshot } = await runMove(moveOnly([{ step: '1', reed: ['issues', 'get', 'ISS-2X6D'] }]))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^runner: issues-move: entry .*reed.* has none of read/)
  assert.equal(snapshot, null)
})

test('runScenario refuses github on a copy without a git_host system: none line', async () => {
  await assert.rejects(runMove(moveOnly([], { fixture: null, github: true })), /github: .*\.pmkit\/config\.yaml has no `system: none`/)
})

test('runScenario stops at an entry that fails and names it', async () => {
  const { problems, snapshot } = await runMove(moveOnly([{ step: '1', read: ['issues', 'get', 'ISS-NOPE'] }, DRY_MOVE]))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^rule 8: read \[step 1\] issues get ISS-NOPE exited \d/)
  assert.equal(snapshot, null)
})

test('runScenario gives the same snapshot twice and leaks no temp path, real date, user or git identity', async () => {
  // github: true adds git, the bare origin and the fake gh to the run, so their environment is checked too.
  const scenario = { ...moveScenario, github: true }
  const home = scratchDir()
  const keys = ['PMKIT_USER', 'HOME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL', 'EMAIL']
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    const first = await runMove(scenario)
    assert.deepEqual(first.problems, [])
    writeFile(home, '.gitconfig', '[user]\n\tname = Leak\n\temail = leak@example.com\n')
    Object.assign(process.env, { PMKIT_USER: 'other', HOME: home, GIT_AUTHOR_EMAIL: 'leak@example.com', GIT_COMMITTER_EMAIL: 'leak@example.com', EMAIL: 'leak@example.com' })
    const second = await runMove(scenario)
    assert.deepEqual(second.problems, [])
    assert.equal(second.snapshot, first.snapshot)
    for (const leak of [os.tmpdir(), fs.realpathSync(os.tmpdir()), 'pmkit-scn-', 'other', 'leak@']) {
      assert.ok(!first.snapshot.includes(leak), `snapshot holds ${leak}`)
    }
    const today = new Date().toISOString().slice(0, 10)
    if (today !== NOW.slice(0, 10)) assert.ok(!first.snapshot.includes(today), `snapshot holds today's date ${today}`)
    assert.match(first.snapshot, /--- gh calls\n\(none\)\n$/)
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runScenario gives expect the saved results of the entries', async () => {
  let seen
  const read = { step: '1', read: ['issues', 'get', 'ISS-2X6D'], save: 'issue' }
  const { problems } = await runMove(moveOnly([read], { expect: (repo, saved) => { seen = saved } }))
  assert.deepEqual(problems.filter((problem) => !problem.startsWith('rule 6')), [])
  assert.equal(seen.issue.id, 'ISS-2X6D')
})

test('the fake gh answers the Nth call of a command with the Nth reply and repeats the last one', () => {
  const gh = fakeGh({ 'pr view x': [{ stdout: 'first' }, { stdout: 'second' }], 'pr view y': { stdout: 'plain' } })
  try {
    const ask = (...args) => spawnSync(path.join(gh.dir, 'gh'), args, { encoding: 'utf8', env: { ...process.env, PMKIT_FAKE_GH: gh.responses } }).stdout
    assert.deepEqual(['pr view x', 'pr view x', 'pr view x'].map((key) => ask(...key.split(' '))), ['first', 'second', 'second'])
    assert.equal(ask('pr', 'view', 'y'), 'plain')
  } finally {
    fs.rmSync(gh.dir, { recursive: true, force: true })
  }
})

const PMKIT = 'node "/plugin/scripts/pmkit.mjs"'
const bash = (rest) => ({ tool: 'Bash', command: `${PMKIT} ${rest}` })
const QUESTION = { tool: 'AskUserQuestion', questions: [{ question: 'Move ISS-2X6D to done?', options: [{ label: 'Yes' }, { label: 'No' }] }] }
const LIVE_LOG = [bash('issues get ISS-2X6D --json'), bash('issues move ISS-2X6D done --dry-run --json'), QUESTION, bash('issues move ISS-2X6D done --json')]

test('traceFromLog maps calls and questions', () => {
  const trace = traceFromLog(LIVE_LOG, COMMANDS)
  assert.deepEqual(trace.map((row) => row.kind), ['read', 'dryRun', 'confirm', 'write'])
  assert.deepEqual(trace[1].args, ['issues', 'move', 'ISS-2X6D', 'done'])
  assert.equal(trace[2].key, undefined)
  assert.deepEqual(orderProblems(trace), [])
  const unconfirmed = traceFromLog(LIVE_LOG.filter((line) => line !== QUESTION), COMMANDS)
  assert.match(orderProblems(unconfirmed)[0], /write .*issues move ISS-2X6D done.*before any confirm/)
})

test('traceFromLog counts an answer turn as a confirm and init as a write', () => {
  const trace = traceFromLog([{ tool: 'turn', answer: 'Yes' }, bash('init --prefix ISS --json')], COMMANDS)
  assert.deepEqual(trace.map((row) => row.kind), ['confirm', 'write'])
})

test('traceFromLog reads every pmkit call of a compound command, through a variable too', () => {
  const command = 'cd /tmp/x; P="/plugin/scripts/pmkit.mjs"; node "$P" issues get A --json && node $P issues move A done --dry-run --json; cat .pmkit/config.yaml'
  const trace = traceFromLog([{ tool: 'Bash', command }, { tool: 'Bash', command: 'git status' }], COMMANDS)
  assert.deepEqual(trace.map((row) => `${row.kind} ${row.args.join(' ')}`), ['read issues get A', 'dryRun issues move A done'])
})

test('traceFromLog fails a write that comes before the question', () => {
  const [read, dryRun, question, write] = LIVE_LOG
  assert.match(orderProblems(traceFromLog([read, dryRun, write, question], COMMANDS))[0], /before any confirm/)
})

test('traceFromLog reads export, node options and bash -c', () => {
  const kinds = (command) => traceFromLog([{ tool: 'Bash', command }], COMMANDS).map((row) => `${row.kind} ${row.args?.join(' ')}`)
  const write = ['write issues move A done']
  assert.deepEqual(kinds('export P=/p/scripts/pmkit.mjs; node "$P" issues move A done --json'), write)
  assert.deepEqual(kinds('node --no-warnings /p/scripts/pmkit.mjs issues move A done --json'), write)
  assert.deepEqual(kinds(`bash -c 'node /p/scripts/pmkit.mjs issues move A done --json'`), write)
  assert.deepEqual(kinds('PMKIT_USER=ana node /p/scripts/pmkit.mjs issues move A done --json'), write)
})

test('traceFromLog marks a command that names pmkit.mjs in a shape it cannot read', () => {
  for (const command of ['xargs -n1 node /p/scripts/pmkit.mjs issues get', 'node -r ./x.cjs /p/scripts/pmkit.mjs issues move A done --json', 'cat /p/scripts/pmkit.mjs']) {
    assert.deepEqual(traceFromLog([{ tool: 'Bash', command }], COMMANDS), [{ kind: 'unparsed', command }], command)
  }
})

test('traceFromLog drops redirections from the args', () => {
  const trace = traceFromLog([{ tool: 'Bash', command: 'node /p/scripts/pmkit.mjs issues get A --json 2>&1 > out.json; node /p/scripts/pmkit.mjs issues comment A --body-file - --json <<\'EOF\'\nhi\nEOF' }], COMMANDS)
  assert.deepEqual(trace.map((row) => `${row.kind} ${row.args.join(' ')}`), ['read issues get A', 'write issues comment A --body-file -'])
})

const T = (kind, args) => ({ kind, step: 'live', args, command: `${args[0]} ${args[1]}` })
const STOP = { kind: 'confirm' }
const TWO_CONFIRMS = [
  { step: '1', dryRun: ['issues', 'move', 'A', 'done'] }, { confirm: 'Step 2' }, { step: '1', write: ['issues', 'move', 'A', 'done'] },
  { step: '3', dryRun: ['issues', 'assign', 'A', 'me'] }, { confirm: 'Step 4' }, { step: '3', write: ['issues', 'assign', 'A', 'me'] },
]
const moveA = ['issues', 'move', 'A', 'done']
const assignA = ['issues', 'assign', 'A', 'me']

test('stopProblems checks every write against the stops the scenario needs before it', () => {
  const good = [T('dryRun', moveA), STOP, T('write', moveA), T('dryRun', assignA), STOP, T('write', assignA)]
  assert.deepEqual(stopProblems({ steps: TWO_CONFIRMS, trace: good, trees: ['b', 'c', 'd'], baseline: 'b' }), [])
  const oneStop = [T('dryRun', moveA), STOP, T('write', moveA), T('dryRun', assignA), T('write', assignA)]
  const problems = stopProblems({ steps: TWO_CONFIRMS, trace: oneStop, trees: ['b', 'c'], baseline: 'b' })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /write issues assign A me came after 1 answer.*needs 2/)
})

test('stopProblems fails when the files change before the first stop the scenario needs', () => {
  const trace = [T('read', ['issues', 'get', 'A']), STOP]
  assert.match(stopProblems({ steps: TWO_CONFIRMS, trace, trees: ['changed', 'changed'], baseline: 'b' })[0], /changed in turn 1, after 0 answers.*needs 1/)
  assert.deepEqual(stopProblems({ steps: TWO_CONFIRMS, trace, trees: ['b', 'changed'], baseline: 'b' }), [])
  const readOnly = [{ step: '1', read: ['issues', 'get', 'A'] }]
  assert.match(stopProblems({ steps: readOnly, trace, trees: ['b', 'changed'], baseline: 'b' })[0], /changed in turn 2.*writes nothing/)
})

test('stopProblems fails a command it cannot read and a write that differs from its dry run', () => {
  assert.match(stopProblems({ steps: TWO_CONFIRMS, trace: [{ kind: 'unparsed', command: 'cat x/pmkit.mjs' }], trees: [], baseline: 'b' })[0], /cat x\/pmkit\.mjs/)
  const other = [T('dryRun', moveA), STOP, T('write', ['issues', 'move', 'A', 'canceled'])]
  assert.match(stopProblems({ steps: TWO_CONFIRMS, trace: other, trees: ['b', 'c'], baseline: 'b' })[0], /issues move A canceled.*no earlier dry run/)
})

test('expectUntilSaved runs an expect up to its first saved read', async () => {
  const seen = []
  const repo = { issue: (id) => { seen.push(id); return { status: 'done' } } }
  const stopsAtSaved = (r, saved) => {
    assert.equal(r.issue('A').status, 'done')
    assert.equal(saved.preview.existing, true)
    r.issue('B')
  }
  assert.equal(await expectUntilSaved(stopsAtSaved, repo), 'saved.preview')
  assert.deepEqual(seen, ['A'])
  assert.equal(await expectUntilSaved((r) => r.issue('C'), repo), null)
  assert.equal(await expectUntilSaved(undefined, repo), null)
  await assert.rejects(expectUntilSaved((r, saved) => {
    assert.equal(r.issue('D').status, 'todo')
    return saved.x
  }, repo), /todo/)
})
