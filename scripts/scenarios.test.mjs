// Scenario tests: every command file under commands/** has a scenario module in scripts/__scenarios__/,
// and these static checks hold for all the command files, scenario or not.
//
// Rule 1  every command file has a scenario and every scenario names a command file
// Rule 2  no snapshot (*.after.txt) is left without a scenario entry
// Rule 3  every flag of every call in a command file exists in the CLI
// Rule 4  every call ends with --json
// Rule 13 a command file with a write call declares a confirmation point
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
  compareScenarios, loadScenarios, parseCommandFile, scenarioName, snapshotFile, staleSnapshots, unknownFlags,
} from './scenario-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COMMANDS_DIR = path.join(HERE, '..', 'commands')
const SCENARIOS = path.join(HERE, '__scenarios__')
const UPDATE = process.env.UPDATE_GOLDENS === '1'
const REGENERATE = 'UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs'
const CLI_NAMES = COMMANDS.map((command) => command.name)

// Scenario names that have no module yet. Each task that adds scenarios removes its names; the last one deletes this set.
const PENDING = new Set([
  'backlog-groom', 'cycle-close', 'cycle-plan', 'help', 'issues-assign', 'issues-breakdown', 'issues-capture',
  'issues-comment', 'issues-create', 'issues-find', 'issues-link', 'issues-mine', 'issues-move', 'issues-pause',
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
      ...missing.map((name) => `command file ${name} has no scenario module scripts/__scenarios__/${name}.mjs`),
      ...extra.map((name) => `scenario module ${name}.mjs names no command file`),
      ...pendingWithScenario.map((name) => `${name} has a scenario module, remove it from PENDING`),
    ]
    assert.deepEqual(problems, [])
  })

  test('no stale snapshot', async () => {
    const loaded = await loadScenarios(SCENARIOS)
    const expected = loaded.flatMap(({ name, entries }) => entries.map((_, index) => snapshotFile(name, index, entries.length)))
    const stale = staleSnapshots(fs.readdirSync(SCENARIOS), expected)
    if (UPDATE) for (const file of stale) fs.rmSync(path.join(SCENARIOS, file))
    else assert.deepEqual(stale, [], `stale snapshots; delete them with ${REGENERATE}`)
  })

  test('every flag of every command file exists in the CLI', () => {
    const problems = []
    for (const { rel, parsed } of FILES) {
      for (const call of parsed.calls) {
        const command = cliOf(call.command)
        if (!command) {
          problems.push(`${rel}: step ${call.step || '(none)'} calls \`${call.command}\`, which is not a CLI command`)
          continue
        }
        if (call.anyFlags) continue
        for (const flag of unknownFlags(call, command)) {
          problems.push(`${rel}: step ${call.step || '(none)'} \`${call.command}\` has --${flag}, which the CLI does not take`)
        }
      }
    }
    // A flag in the prose of a step with no call to join must exist in some command.
    // `accept-command` is a flag of `claude plugin update` (upgrade.md step 4), not of the pmkit CLI.
    const known = new Set(['json', 'root', 'dry-run', 'as', 'accept-command', ...COMMANDS.flatMap((c) => [...(c.flags ?? []), ...(c.booleans ?? [])])])
    for (const { rel, parsed } of FILES) {
      for (const { step, flag } of parsed.looseFlags) {
        if (!known.has(flag)) problems.push(`${rel}: step ${step || '(none)'} names --${flag} in its prose, and no CLI command takes it`)
      }
    }
    assert.deepEqual(problems, [])
  })

  test('every call ends with --json', () => {
    const problems = FILES.flatMap(({ rel, parsed }) => parsed.calls
      .filter((call) => !call.endsWithJson)
      .map((call) => `${rel}: step ${call.step || '(none)'} \`${call.text}\` does not end with --json`))
    assert.deepEqual(problems, [])
  })

  test('every command file with a write call declares a confirmation point', () => {
    const problems = FILES
      .filter(({ parsed }) => parsed.calls.some(isWrite) && !parsed.points.length)
      .map(({ rel }) => `${rel} has a write call and no confirmation point in "## Confirmation points"`)
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
})
