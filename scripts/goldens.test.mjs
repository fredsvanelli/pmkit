// Golden output tests: every command in COMMANDS, run on every fixture in FIXTURES,
// must print exactly what its file under scripts/__goldens__/<fixture>/ says.
//
// Regenerate every golden, and delete the ones that match no command, with:
//
//   UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs
//
// Then read `git diff scripts/__goldens__/` and commit the goldens with the change
// that caused them. Never edit a golden by hand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'
import {
  compareNames, displayArgs, expandCase, findCollisions, formatRun, goldenName, makeNormalizer, mapLimit, runPmkit, staleGoldens,
} from './golden-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDENS = path.join(HERE, '__goldens__')
const INPUTS = path.join(GOLDENS, '_inputs')
const UPDATE = process.env.UPDATE_GOLDENS === '1'
const REGENERATE = 'UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs'
const LIMIT = Math.max(2, os.cpus().length)

const input = (name) => path.join(INPUTS, name)

// Anchors are the IDs the cases use. An anchor missing from its fixture is on purpose:
// the golden then records the NOT_FOUND error, which is the command's real output there.
const FIXTURES = {
  basic: {
    about: 'empty: config files only, no issues, epics, sprints or documents',
    issue: 'ISS-0000', other: 'ISS-0001', conflicted: 'ISS-0000', epic: 'EPC-0000', sprint: '2026-10-12', doc: 'missing.md', milestone: 'v1.0',
  },
  team: {
    about: 'small team: 2 members, 13 issues, 1 epic, a closed and an active sprint, ISS-3Q6T has conflict markers',
    issue: 'ISS-5N1R', other: 'ISS-4M2S', conflicted: 'ISS-3Q6T', epic: 'EPC-2M9D', sprint: '2026-10-12', doc: 'missing.md', milestone: 'v1.0',
  },
  'messy-merge': {
    about: 'after merging two tracker branches: ISS-4 add/add conflict, ISS-5 status conflict, ISS-6 events out of order, two active sprints',
    issue: 'ISS-1', other: 'ISS-2', conflicted: 'ISS-4', epic: 'EPC-1', sprint: '2026-10-12', doc: 'missing.md', milestone: 'v1.0',
  },
  'no-sprints': {
    about: 'a team without sprints: 6 issues, an epic with children, a comment, a document and a milestone',
    // v1.0 is the one milestone file. ISS-9B2X holds the one comment, is in_review and has no parent, so get --comments, move and parent show real output.
    issue: 'ISS-9B2X', other: 'ISS-6R3N', conflicted: 'ISS-0000', epic: 'EPC-4H7V', sprint: '2026-10-12', doc: 'specs/overview.md', milestone: 'v1.0',
  },
}

// One entry per command in COMMANDS: the argument lists after the command name.
// Each case runs as text and --json, and a write also runs with --dry-run.
const CASES = {
  init: () => [[], ['--update'], ['--root', 'fresh']],
  capabilities: () => [[]],
  discover: () => [[]],
  whoami: () => [[]],
  'issues list': () => [[], ['--sprint', 'current'], ['--blocked'], ['--category', 'done']],
  'issues get': (a) => [[a.issue], [a.issue, '--comments', '--history'], [a.conflicted]],
  'issues create': () => [['--title', 'Golden sample', '--type', 'task', '--description-file', input('description.md')]],
  'issues update': (a) => [[a.issue, '--title', 'Renamed', '--criteria-file', input('criteria.md')]],
  'issues move': (a) => [[a.issue, 'done'], [a.conflicted, 'done']],
  'issues assign': (a) => [[a.issue, 'fred']],
  'issues link': (a) => [[a.issue, a.other, '--kind', 'blocks']],
  'issues parent': (a) => [[a.issue, a.epic]],
  'issues comment': (a) => [[a.issue, '--body-file', input('comment.md')]],
  'issues log-time': (a) => [[a.issue, '30']],
  'issues archive': (a) => [[a.issue]],
  'cycle list': () => [[], ['--state', 'closed']],
  'cycle current': () => [[]],
  'cycle issues': (a) => [[a.sprint]],
  'cycle open': () => [['--start', '2026-10-26']],
  'cycle close': (a) => [[a.sprint]],
  'cycle add': (a) => [[a.issue, '--to', 'current']],
  'cycle capacity': (a) => [[a.sprint]],
  'epic list': () => [[]],
  'epic get': (a) => [[a.epic]],
  'epic progress': (a) => [[a.epic]],
  'epic create': () => [['--title', 'Golden epic']],
  'milestone list': () => [[]],
  'milestone get': (a) => [[a.milestone], ['missing-milestone']],
  // A new id, and the anchor again, which is a CONFLICT where the milestone exists.
  'milestone create': (a) => [['v2.0', '--name', 'Golden milestone', '--due', '2026-12-01'], [a.milestone]],
  'epic update-status': (a) => [[a.epic, '--health', 'on_track', '--body-file', input('update.md')]],
  'epic updates': (a) => [[a.epic]],
  'docs read': (a) => [[a.doc]],
  'docs create': () => [['golden/new.md', '--body-file', input('doc.md')]],
  'metrics velocity': () => [[]],
  'metrics cycle-time': () => [[]],
  'metrics lead-time': () => [[]],
  events: () => [[]],
  'issues branch': (a) => [[a.issue]],
  'pr open': (a) => [['--issue', a.issue]],
  'pr ready': (a) => [['--issue', a.issue]],
  'pr status': () => [[]],
  'pr sync': () => [[]],
  changelog: () => [['--file', input('CHANGELOG.md'), '--since', '0.0.0'], ['--file', input('CHANGELOG.md'), '--since', '0.3.0']],
  migrate: () => [[]],
  reindex: () => [[]],
  validate: () => [[]],
}

const commandNames = COMMANDS.map((command) => command.name)
// Writes, and init (which takes --dry-run without being a write), also run with --dry-run.
const takesDryRun = (command) => Boolean(command.write || command.dryRun)
const goldenPath = (fixture, name) => path.join(GOLDENS, fixture, `${goldenName(name)}.txt`)
const relative = (file) => path.relative(path.dirname(HERE), file).split(path.sep).join('/')

/** Runs one argument list on a fresh copy of the fixture and returns its transcript block. */
async function runOnce(fixture, args) {
  const root = makeRepo(fixture)
  try {
    const result = await runPmkit(args, root)
    return makeNormalizer({ root, inputs: INPUTS })(formatRun({ ...result, args: displayArgs(args, { root, inputs: INPUTS }) }))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const firstDifference = (actual, expected) => {
  const a = actual.split('\n')
  const b = expected.split('\n')
  let line = 0
  while (line < a.length && line < b.length && a[line] === b[line]) line++
  return line + 1
}

test('CASES covers exactly COMMANDS', () => {
  const { missing, extra } = compareNames(Object.keys(CASES), commandNames)
  const lines = [
    ...missing.map((name) => `command "${name}" has no entry in CASES`),
    ...extra.map((name) => `CASES entry "${name}" names no command in COMMANDS`),
    ...findCollisions(commandNames).map((names) => `commands ${names.map((n) => `"${n}"`).join(' and ')} share one golden file`),
  ]
  assert.deepEqual(lines, [], `${lines.join('\n')}\nAdd or remove the case, then regenerate with: ${REGENERATE}`)
})

for (const [fixture, anchors] of Object.entries(FIXTURES)) {
  test(`goldens: ${fixture} (${anchors.about})`, async (t) => {
    const commands = COMMANDS.filter((command) => CASES[command.name])
    const jobs = commands.flatMap((command) => CASES[command.name](anchors)
      .flatMap((args) => expandCase(takesDryRun(command), args))
      .map((args) => ({ command: command.name, args: [...command.name.split(' '), ...args] })))
    const blocks = await mapLimit(jobs, LIMIT, (job) => runOnce(fixture, job.args))
    for (const command of commands) {
      const actual = `${blocks.filter((_, i) => jobs[i].command === command.name).join('\n\n')}\n`
      const file = goldenPath(fixture, command.name)
      await t.test(command.name, () => {
        if (UPDATE) {
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, actual)
          return
        }
        if (!fs.existsSync(file)) assert.fail(`missing golden ${relative(file)}. Generate it with: ${REGENERATE}`)
        const expected = fs.readFileSync(file, 'utf8')
        assert.equal(actual, expected, `${relative(file)} differs from the CLI output at line ${firstDifference(actual, expected)}. If the change is intended, regenerate with: ${REGENERATE}`)
      })
    }
  })
}

// Entries that should not be there: a file or folder at the top of __goldens__ that is
// neither _inputs nor a fixture, and a file in a fixture folder that matches no command.
const findStale = () => [
  ...(fs.existsSync(GOLDENS) ? fs.readdirSync(GOLDENS).filter((name) => name !== '_inputs' && !Object.hasOwn(FIXTURES, name)).sort() : [])
    .map((name) => path.join(GOLDENS, name)),
  ...Object.keys(FIXTURES).flatMap((fixture) => staleGoldens(path.join(GOLDENS, fixture), commandNames).map((name) => path.join(GOLDENS, fixture, name))),
]

test('no stale goldens', () => {
  if (UPDATE) for (const file of findStale()) fs.rmSync(file, { recursive: true, force: true })
  const stale = findStale()
  assert.deepEqual(stale.map(relative), [], `golden entries that match no command or fixture: ${stale.map(relative).join(', ')}. Delete them with: ${REGENERATE}`)
})
