import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMANDS } from './pmkit.mjs'
import {
  scenarioName, snapshotFile, parseCommandFile, callKey, unknownFlags,
  matchEntry, coverageProblems, pointProblems, orderProblems, compareScenarios, staleSnapshots,
} from './scenario-helpers.mjs'

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

test('compareScenarios reports missing, extra and pending names that have a scenario', () => {
  const found = compareScenarios(['a', 'b', 'c'], ['b', 'c', 'x'], new Set(['a', 'c']))
  assert.deepEqual(found, { missing: [], extra: ['x'], pendingWithScenario: ['c'] })
  assert.deepEqual(compareScenarios(['a', 'b'], ['b'], new Set()).missing, ['a'])
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
