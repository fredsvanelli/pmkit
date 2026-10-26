// Scenario tests: every command file under commands/** has a scenario module in scripts/__scenarios__/,
// and these static checks hold for all the command files, scenario or not.
//
// Rule 1  every command file has a scenario and every scenario names a command file
// Rule 2  no snapshot (*.after.txt) is left without a scenario entry
// Rule 3  every flag of every call in a command file exists in the CLI
// Rule 4  every call ends with --json
// Rule 13 a command file with a write call declares a confirmation point
//
// Each scenario entry then runs on a fresh copy of its fixture (scenario-helpers.mjs, runScenario):
//
// Rule 5  every read, dry run and write matches a call of the same step
// Rule 6  every call of the procedure is used by an entry or listed in skip
// Rule 7  the confirmation points of the file are confirmed or listed in notHit
// Rule 8  every read and dry run exits 0 (or with its expectError), prints JSON and writes nothing outside .git
// Rule 9  every write and edit comes after a confirm, and a write that repeats a dry run after that dry run
// Rule 10 every confirm names a confirmation point of the file
// Rule 11 expect(repo) passes
// Rule 12 the snapshot equals <name>.after.txt, or <name>.<index>.after.txt (index from 0) for an array export
//
// Regenerate the snapshots, and delete the stale ones, with:
//
//   UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs
//
// Then read `git diff scripts/__scenarios__/` and commit the snapshots with the change that caused them.
// Never edit a snapshot by hand.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from './pmkit.mjs'
import {
  compareScenarios, loadScenarios, parseCommandFile, runScenario, scenarioName, snapshotFile, staleSnapshots, unknownFlags,
} from './scenario-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COMMANDS_DIR = path.join(HERE, '..', 'commands')
const SCENARIOS = path.join(HERE, '__scenarios__')
const FIXTURES = path.join(HERE, '__fixtures__')
const INPUTS = path.join(SCENARIOS, '_inputs')
const UPDATE = process.env.UPDATE_GOLDENS === '1'
const REGENERATE = 'UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs'
const CLI_NAMES = COMMANDS.map((command) => command.name)

// Scenario names that have no module yet. Each task that adds scenarios removes its names; the last one deletes this set.
const PENDING = new Set([
  'backlog-groom', 'cycle-close', 'cycle-plan', 'help', 'issues-assign', 'issues-breakdown', 'issues-capture',
  'issues-comment', 'issues-create', 'issues-find', 'issues-link', 'issues-mine', 'issues-pause',
  'issues-progress', 'issues-summary', 'issues-update', 'issues-work', 'local-doctor', 'report-status', 'setup',
  'spec-import', 'team-standup', 'upgrade',
])

function commandFiles(dir = COMMANDS_DIR, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return commandFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
    return entry.name.endsWith('.md') ? [`${prefix}${entry.name}`] : []
  }).sort()
}

const FILES = commandFiles().map((rel) => ({
  rel,
  name: scenarioName(rel),
  parsed: parseCommandFile(fs.readFileSync(path.join(COMMANDS_DIR, rel), 'utf8'), CLI_NAMES),
}))
const LOADED = await loadScenarios(SCENARIOS)
const cliOf = (name) => COMMANDS.find((command) => command.name === name)
const isWrite = (call) => call.dryRun || Boolean(cliOf(call.command)?.write)

describe('scenarios', { concurrency: Math.max(2, os.cpus().length) }, () => {
  test('there are 24 command files', () => {
    assert.equal(FILES.length, 24, FILES.map((file) => file.rel).join(', '))
  })

  test('every command file has a scenario', async () => {
    const loaded = await loadScenarios(SCENARIOS)
    const { missing, extra, pendingWithScenario } = compareScenarios(FILES.map((f) => f.name), loaded.map((s) => s.name), PENDING)
    const problems = [
      ...missing.map((name) => `rule 1: command file ${name} has no scenario module scripts/__scenarios__/${name}.mjs`),
      ...extra.map((name) => `rule 1: scenario module ${name}.mjs names no command file`),
      ...pendingWithScenario.map((name) => `rule 1: ${name} has a scenario module, remove it from PENDING`),
    ]
    assert.deepEqual(problems, [])
  })

  test('no stale snapshot', async () => {
    const loaded = await loadScenarios(SCENARIOS)
    const expected = loaded.flatMap(({ name, entries }) => entries.map((_, index) => snapshotFile(name, index, entries.length)))
    const stale = staleSnapshots(fs.readdirSync(SCENARIOS), expected)
    if (UPDATE) for (const file of stale) fs.rmSync(path.join(SCENARIOS, file))
    else assert.deepEqual(stale, [], `rule 2: stale snapshots; delete them with ${REGENERATE}`)
  })

  test('every flag of every command file exists in the CLI', () => {
    const problems = []
    for (const { rel, parsed } of FILES) {
      for (const call of parsed.calls) {
        const command = cliOf(call.command)
        if (!command) {
          problems.push(`rule 3: ${rel}: step ${call.step || '(none)'} calls \`${call.command}\`, which is not a CLI command`)
          continue
        }
        if (call.anyFlags) continue
        for (const flag of unknownFlags(call, command)) {
          problems.push(`rule 3: ${rel}: step ${call.step || '(none)'} \`${call.command}\` has --${flag}, which the CLI does not take`)
        }
      }
    }
    // A flag in the prose of a step with no call to join must exist in some command.
    // `accept-command` is a flag of `claude plugin update` (upgrade.md step 4), not of the pmkit CLI.
    const known = new Set(['json', 'root', 'dry-run', 'as', 'accept-command', ...COMMANDS.flatMap((c) => [...(c.flags ?? []), ...(c.booleans ?? [])])])
    for (const { rel, parsed } of FILES) {
      for (const { step, flag } of parsed.looseFlags) {
        if (!known.has(flag)) problems.push(`rule 3: ${rel}: step ${step || '(none)'} names --${flag} in its prose, and no CLI command takes it`)
      }
    }
    assert.deepEqual(problems, [])
  })

  test('every call ends with --json', () => {
    const problems = FILES.flatMap(({ rel, parsed }) => parsed.calls
      .filter((call) => !call.endsWithJson)
      .map((call) => `rule 4: ${rel}: step ${call.step || '(none)'} \`${call.text}\` does not end with --json`))
    assert.deepEqual(problems, [])
  })

  test('every command file with a write call declares a confirmation point', () => {
    const problems = FILES
      .filter(({ parsed }) => parsed.calls.some(isWrite) && !parsed.points.length)
      .map(({ rel }) => `rule 13: ${rel} has a write call and no confirmation point in "## Confirmation points"`)
    assert.deepEqual(problems, [])
  })

  test('the real files parse to the expected step ids', () => {
    const file = (rel) => FILES.find((f) => f.rel === rel).parsed
    const has = (rel, step, command, section) =>
      file(rel).calls.some((c) => c.step === step && (!command || c.command === command) && (!section || c.section === section))
    assert.ok(has('setup.md', 'First run 6'), 'setup.md First run 6')
    assert.ok(has('setup.md', 'Existing config 7'), 'setup.md Existing config 7')
    assert.ok(has('upgrade.md', '5', 'migrate'), 'upgrade.md 5 migrate')
    assert.ok(has('local/doctor.md', '2.1', 'issues get'), 'local/doctor.md 2.1 issues get')
    assert.ok(has('local/doctor.md', '4', 'issues parent'), 'local/doctor.md 4 issues parent')
    assert.ok(file('report/status.md').calls.some((c) => c.command === 'epic list' && c.section === 'other'), 'report/status.md epic list in other')
  })

  for (const { name, entries } of LOADED) {
    entries.forEach((scenario, index) => {
      const file = snapshotFile(name, index, entries.length)
      test(`scenario ${file.replace(/\.after\.txt$/, '')}`, async () => {
        const command = FILES.find((f) => f.name === scenarioName(scenario.command))
        assert.ok(command, `rule 1: scenario ${name} names commands/${scenario.command}.md, which does not exist`)
        assert.equal(scenarioName(scenario.command), name, `rule 1: scenario ${name}.mjs names ${scenario.command}; the module name must be ${scenarioName(scenario.command)}`)
        const { problems, snapshot } = await runScenario(scenario, {
          name, parsed: command.parsed, cliCommands: COMMANDS, fixturesDir: FIXTURES, inputsDir: INPUTS,
        })
        assert.deepEqual(problems, [], `${file}:\n${problems.join('\n')}\nFix the scenario or the command file, then run ${REGENERATE}`)
        const target = path.join(SCENARIOS, file)
        if (UPDATE) fs.writeFileSync(target, snapshot)
        else {
          assert.ok(fs.existsSync(target), `rule 12: ${file} does not exist; create it with ${REGENERATE}`)
          assert.equal(snapshot, fs.readFileSync(target, 'utf8'), `rule 12: ${file} differs from the run; if the change is intended, run ${REGENERATE}`)
        }
      })
    })
  }
})
