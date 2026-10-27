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
import { CASES, FIXTURES, INPUTS, takesDryRun } from './golden-cases.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDENS = path.join(HERE, '__goldens__')
const UPDATE = process.env.UPDATE_GOLDENS === '1'
const REGENERATE = 'UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs'
const LIMIT = Math.max(2, os.cpus().length)

const commandNames = COMMANDS.map((command) => command.name)
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
