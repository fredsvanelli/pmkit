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
// Rule 6  every call of the procedure is used by an entry or listed in skip, in any scenario of the command (PMK-355)
// Rule 7  the confirmation points of the file are confirmed or listed in notHit, in any scenario of the command
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
  compareScenarios, loadScenarios, parseCommandFile, runScenario, scenarioName, siblingCoverage, snapshotFile, staleSnapshots, unknownFlags,
} from './scenario-helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COMMANDS_DIR = path.join(HERE, '..', 'commands')
const SCENARIOS = path.join(HERE, '__scenarios__')
const FIXTURES = path.join(HERE, '__fixtures__')
const INPUTS = path.join(SCENARIOS, '_inputs')
const UPDATE = process.env.UPDATE_GOLDENS === '1'
const REGENERATE = 'UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs'
const CLI_NAMES = COMMANDS.map((command) => command.name)

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
  test('there are 59 command files', () => {
    assert.equal(FILES.length, 59, FILES.map((file) => file.rel).join(', '))
  })

  test('every command file has a scenario', async () => {
    const loaded = await loadScenarios(SCENARIOS)
    const { missing, extra } = compareScenarios(FILES.map((f) => f.name), loaded.map((s) => s.name))
    const problems = [
      ...missing.map((name) => `rule 1: command file ${name} has no scenario module scripts/__scenarios__/${name}.mjs`),
      ...extra.map((name) => `rule 1: scenario module ${name}.mjs names no command file`),
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
    // `yes` is read by commands/link-repo.md itself (step 6) and never passed to the CLI, so only that file may name it.
    const known = new Set(['json', 'root', 'dry-run', 'as', 'accept-command', ...COMMANDS.flatMap((c) => [...(c.flags ?? []), ...(c.booleans ?? [])])])
    for (const { rel, parsed } of FILES) {
      for (const { step, flag } of parsed.looseFlags) {
        if (!known.has(flag) && !(flag === 'yes' && rel === 'link-repo.md')) problems.push(`rule 3: ${rel}: step ${step || '(none)'} names --${flag} in its prose, and no CLI command takes it`)
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
    assert.ok(has('setup.md', 'Existing config 8', 'init'), 'setup.md Existing config 8 init')
    assert.ok(has('upgrade.md', '5', 'migrate'), 'upgrade.md 5 migrate')
    assert.ok(has('local/doctor.md', '2.1', 'issues get'), 'local/doctor.md 2.1 issues get')
    assert.ok(has('local/doctor.md', '4', 'issues parent'), 'local/doctor.md 4 issues parent')
    assert.ok(has('local/render.md', '3', 'render'), 'local/render.md 3 render')
    assert.ok(file('report/status.md').calls.some((c) => c.command === 'epic list' && c.section === 'other'), 'report/status.md epic list in other')
  })

  test('cycle/close step 8 runs cycle close after every issues link and issues move call', () => {
    const step8 = FILES.find((file) => file.rel === 'cycle/close.md').parsed.calls
      .filter((call) => call.step === '8' && !call.dryRun)
      .map((call) => call.command)
    const close = step8.indexOf('cycle close')
    assert.ok(close >= 0, 'step 8 runs cycle close')
    for (const name of ['issues link', 'issues move']) {
      assert.ok(step8.includes(name), `step 8 runs ${name}`)
      assert.ok(step8.lastIndexOf(name) < close, `${name} comes before cycle close in step 8`)
    }
  })

  test('cycle/close carries a split\'s open blockers, open sub-issues and unchecked criteria to the new issue', () => {
    const calls = FILES.find((file) => file.rel === 'cycle/close.md').parsed.calls
    const create = calls.find((c) => c.step === '7' && c.command === 'issues create' && c.dryRun)
    assert.ok(create?.flags.includes('criteria-file'), 'the step 7 create carries the unchecked criteria')
    const step8 = calls.filter((c) => c.step === '8' && !c.dryRun)
    const move = step8.findIndex((c) => c.command === 'issues move')
    const blocks = step8.findIndex((c) => c.command === 'issues link' && /--kind blocks(?:\s|$)/.test(c.text))
    const parent = step8.findIndex((c) => c.command === 'issues parent')
    const related = step8.findIndex((c) => c.command === 'issues link' && /--kind related(?:\s|$)/.test(c.text))
    assert.ok(blocks >= 0 && blocks < move, 'step 8 links each open blocker to the new issue before the move to done')
    assert.ok(parent >= 0 && parent < move, 'step 8 moves each open sub-issue to the new issue before the move to done')
    assert.ok(related >= 0 && related < blocks && related < parent, 'step 8 runs the related link before the blocker links and sub-issue moves')
    const text = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'close.md'), 'utf8')
    assert.match(text, /`blockedBy` and `children` whose status category is not `done` or `canceled`/)
  })

  test('cycle/close step 7 previews the blocker links and sub-issue moves of a split', () => {
    const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'close.md'), 'utf8').split('\n')
    const step7 = lines.slice(lines.findIndex((line) => line.startsWith('7. ')), lines.findIndex((line) => line.startsWith('8. '))).join('\n')
    assert.match(step7, /a `blocks` link from each open blocker to the new issue/, 'the step 7 preview shows the blocker links')
    assert.match(step7, /a parent change that moves each open sub-issue from the original to the new issue/, 'the step 7 preview shows the sub-issue moves')
    assert.doesNotMatch(step7, /The close does not move or copy them/, 'step 7 no longer says the close leaves them on the original')
    const point = lines.find((line) => line.startsWith('- Step 7: '))
    assert.match(point, /the blocker links and sub-issue moves/, 'the Step 7 confirmation point names the carry-over writes')
  })

  test('backlog/triage proposes four kinds of decision and previews every write with a dry run', () => {
    const file = FILES.find((f) => f.rel === 'backlog/triage.md')
    assert.ok(file, 'commands/backlog/triage.md exists')
    const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n')
    const step = (n) => lines.find((line) => line.startsWith(`${n}. `)) ?? ''
    const has = (step_, command, dry) => file.parsed.calls.some((c) => c.step === step_ && c.command === command && c.dryRun === dry)
    assert.ok(has('1', 'issues list', false) && has('2', 'discover', false), 'steps 1 and 2 read the queue and the allowed values')
    assert.match(file.parsed.calls.find((c) => c.step === '1').text, /--category triage/)
    assert.match(step(4), /proposal.*priority.*labels/s, 'step 4 shows proposal, priority and labels')
    for (const kind of ['accept', 'duplicate of', 'decline', 'needs info']) assert.ok(step(4).includes(kind), `step 4 names ${kind}`)
    assert.ok(step(4).includes('`duplicate of <id> (<status>)`'), 'step 4 shows the status of the original')
    for (const command of ['issues update', 'issues move', 'issues link', 'issues comment']) assert.ok(has('6', command, true), `step 6 dry-runs ${command}`)
    assert.ok(!file.parsed.calls.some((c) => c.step === '6' && !c.dryRun && ['issues update', 'issues move', 'issues link', 'issues comment'].includes(c.command)), 'step 6 has no write without --dry-run')
    assert.match(step(8), /without `--dry-run`/, 'step 8 runs the step 6 commands as writes')
    assert.match(step(7), /whatever `write_policy.confirm` says/)
    assert.match(step(7), /When the user declines, change nothing/)
    assert.match(step(3), /is a guess/, 'a duplicate match is called a guess')
    const text = lines.join('\n')
    for (const needle of ['`discover` lists no labels', 'A proposed original cannot be read']) assert.ok(text.includes(needle), `the missing-cases section names: ${needle}`)
  })

  test('backlog/triage moves an accepted issue to backlog and a duplicate or declined one to canceled', () => {
    const step6 = FILES.find((f) => f.rel === 'backlog/triage.md').parsed.calls.filter((c) => c.step === '6' && c.dryRun)
    const texts = step6.map((c) => c.text)
    assert.ok(texts.includes('issues move <id> backlog --dry-run --json'), 'an accepted issue moves to backlog')
    assert.ok(texts.includes('issues move <dup> canceled --dry-run --json'), 'a duplicate moves to canceled')
    assert.ok(texts.includes('issues move <id> canceled --dry-run --json'), 'a declined issue moves to canceled')
    assert.ok(texts.includes('issues link <dup> <kept> --kind duplicate --dry-run --json'), 'a duplicate gets a duplicate link')
    assert.ok(step6.some((c) => c.command === 'issues comment' && c.flags.includes('body-file')), 'a declined issue gets a comment')
    // A comment dry run returns the comment record, not a before and after, so the preview names the text itself.
    const step7 = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n').find((line) => line.startsWith('7. '))
    assert.match(step7, /and the text of each decline comment/, 'the step 7 preview shows the decline comment')
  })

  // `issues list --text` matches one substring of the title and description, so "login slow" finds nothing
  // where "login" finds the original.
  test('backlog/triage searches for duplicates one key word at a time', () => {
    const search = FILES.find((f) => f.rel === 'backlog/triage.md').parsed.calls.find((c) => c.step === '3' && c.command === 'issues list')
    assert.equal(search?.text, 'issues list --text "<key word>" --json')
    const step3 = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n')
      .find((line) => line.includes('issues list --text'))
    assert.match(step3, /once for each key word of the title, one word per search/)
    assert.match(step3, /`--text` matches one substring of the title or description/)
  })

  test('backlog/triage reads the comments of every issue in the queue', () => {
    const line = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n')
      .find((l) => l.includes('issues get <id> --comments --json'))
    assert.match(line, /for every issue in the queue, because `issues list` returns the description but not the comments/)
  })

  // Two triage issues that repeat each other must not each be proposed as a duplicate of the other: applying all
  // proposals would cancel both. No scenario has such a pair, so this test pins the rule.
  test('backlog/triage keeps one issue of each set that repeats each other', () => {
    const step3 = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n')
      .find((line) => line.includes('issues list --text'))
    assert.ok(step3.includes('Keep one issue of each set of issues that repeat each other: the one outside `triage` when there is one, otherwise the oldest by `created`.'), 'step 3 names the kept issue')
    assert.ok(step3.includes('Never propose `duplicate` or `decline` for a kept issue that is in the queue'), 'step 3 never cancels the kept issue')
  })

  // The one-by-one answers of the scenario depend on this order: a needs-info issue gets a question like the others.
  test('backlog/triage one-by-one asks about every issue in queue order, needs-info ones included', () => {
    const step5 = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n')
      .find((line) => line.startsWith('5. '))
    assert.ok(step5.includes('The one-by-one path asks about every issue in the queue in queue order'), 'step 5 asks about every issue in order')
    assert.ok(step5.includes('For a needs-info issue the choices are to give a priority and labels, which accepts it, or to skip it.'), 'step 5 covers needs-info issues')
  })

  // The in_review assertion encodes the PMK-122 decision (follow-up 1 of the spec). Change it when that issue lands.
  test('cycle/plan step 5 drafts from todo, backlog, in_progress and in_review issues with no sprint, in both calls', () => {
    const calls = FILES.find((file) => file.rel === 'cycle/plan.md').parsed.calls
      .filter((c) => c.step === '5' && c.command === 'issues list' && !c.dryRun)
    assert.equal(calls.length, 2, 'step 5 runs issues list twice, the second with --blocked')
    for (const call of calls) {
      const categories = call.text.match(/--category (\S+)/)?.[1].split(',') ?? []
      // in_review since PMK-164: cycle close sends one back with no sprint and its status kept.
      for (const name of ['todo', 'backlog', 'in_progress', 'in_review']) assert.ok(categories.includes(name), `step 5 reads ${name}`)
      for (const name of ['done', 'canceled', 'triage']) assert.ok(!categories.includes(name), `step 5 leaves out ${name}`)
      // `--sprint none` as a whole value: `--sprint none2` must not pass.
      assert.match(call.text, /(?:^|\s)--sprint none(?:\s|$)/)
    }
  })

  test('cycle/plan step 8 shows the status of each offered issue', () => {
    const step8 = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n').find((line) => line.startsWith('8. '))
    assert.ok(step8, 'plan.md has a step 8')
    assert.match(step8, /table \(ID, title, status, estimate, assignee, blocked by\)/)
  })

  test('cycle/plan step 5 reads blockers outside its list, counts canceled as closed and names what it leaves out', () => {
    const calls = FILES.find((file) => file.rel === 'cycle/plan.md').parsed.calls
    assert.ok(calls.some((c) => c.step === '5' && c.command === 'issues list' && c.flags.includes('blocked') && !c.dryRun), 'step 5 lists the candidates with an open blocker')
    assert.ok(calls.some((c) => c.step === '5' && c.command === 'issues get' && !c.dryRun), 'step 5 reads each blocker outside its list')
    const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n')
    const step5 = lines.find((line) => line.startsWith('5. '))
    assert.match(step5, /An open blocker is a `blockedBy` issue not in `done` or `canceled`/)
    assert.match(step5, /the blocker's `sprint` is that sprint's ID/, 'a blocker already in the planned sprint counts as selected')
    assert.match(lines.find((line) => line.startsWith('8. ')), /left out for an open blocker/)
    assert.match(lines.find((line) => line.startsWith('The sprint plan.')), /every issue in the scope whose open blocker is not in the sprint/)
  })

  // The orchestrator's ruling on I1: no scenario covers a blocker already in the planned sprint (follow-up 6 of the
  // spec), so this test pins the whole rule sentence.
  test('cycle/plan step 5 counts a blocker already in the planned sprint as selected', () => {
    const step5 = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n').find((line) => line.startsWith('5. '))
    assert.ok(step5, 'plan.md has a step 5')
    assert.ok(step5.includes("A blocker counts as selected when it is in the selection, or when step 1 chose an existing `planned` sprint and the blocker's `sprint` is that sprint's ID"), 'step 5 counts a blocker in the planned sprint as selected')
  })

  describe('team/flow-metrics', () => {
    const file = FILES.find((f) => f.rel === 'team/flow-metrics.md')
    const text = fs.readFileSync(path.join(COMMANDS_DIR, 'team', 'flow-metrics.md'), 'utf8')
    const stepText = (n) => text.split('\n').find((line) => line.startsWith(`${n}. `)) ?? ''
    const stepCalls = (n) => file.parsed.calls.filter((call) => call.step === String(n) && !call.dryRun)
    const flagsOf = (call) => (Array.isArray(call.flags) ? call.flags : Object.keys(call.flags ?? {}))

    test('reads the four metrics for the period in step 3 and for the previous period in step 4', () => {
      for (const n of [3, 4]) {
        const calls = stepCalls(n)
        assert.deepEqual(calls.map((call) => call.command).sort(), ['metrics aging', 'metrics cycle-time', 'metrics lead-time', 'metrics throughput'], `step ${n}`)
        for (const call of calls) {
          const flags = flagsOf(call)
          assert.ok(flags.includes('until'), `step ${n} ${call.command} has until`)
          assert.equal(flags.includes('since'), call.command !== 'metrics aging', `step ${n} ${call.command} since`)
        }
      }
      const text3 = stepCalls(3).find((call) => call.command === 'metrics cycle-time').text
      const text4 = stepCalls(4).find((call) => call.command === 'metrics cycle-time').text
      assert.notEqual(text3, text4)
    })

    test('has no write call and no confirmation point', () => {
      assert.equal(file.parsed.calls.some(isWrite), false)
      assert.deepEqual(file.parsed.points, [])
    })

    test('step 2 rejects a since after until and shows the month-end example', () => {
      const step2 = stepText(2)
      assert.match(step2, /after `?U`?|after `until`/)
      assert.ok(step2.includes('2026-10-30') && step2.includes('2026-11-01'), 'month-end example')
      assert.deepEqual(stepCalls(2), [])
    })

    test('says the numbers come from the event history, names the DORA gap and the small sample', () => {
      assert.match(text, /event history/)
      assert.match(text, /events\.jsonl/)
      assert.match(text, /This report has no DORA metrics, because the tracker holds no deployment data/)
      assert.match(text, /fewer than 5/)
    })

    test('stops when the tracker has no metrics', () => {
      assert.match(stepText(1), /absent/)
      assert.match(stepText(1), /enableHint/)
    })

    test('gives no verdict', () => {
      const output = text.split('## Output')[1].split('## If something is missing')[0]
      assert.doesNotMatch(output, /\b(better|worse)\b/)
    })

    test('tells the model to give no judgment on a change', () => {
      assert.ok(text.includes('Give no judgment on whether a change helps or hurts.'))
    })

    test('step 5 computes the bug rate from byType.bug over count, in whole percent, n/a for a count of 0', () => {
      const step5 = stepText(5)
      assert.ok(step5.includes('`byType.bug`'), 'reads byType.bug')
      assert.match(step5, /divided by `count`/)
      assert.match(step5, /When `count` is 0, the bug rate is `n\/a`/)
      assert.match(step5, /whole percent/)
      assert.ok(step5.includes('(0 when the key is missing)'), 'missing byType.bug counts as 0')
    })

    test('step 2 sets the previous period to S minus N days through S minus 1 day, and the default window from the config', () => {
      const step2 = stepText(2)
      assert.ok(step2.includes('from `S` minus `N` days to `S` minus 1 day'), 'previous period bounds')
      assert.ok(step2.includes('`defaults.sprint_length_days`'), 'default window comes from the config')
      assert.ok(step2.includes('`S` is `U` minus (`defaults.sprint_length_days` minus 1) days'), 'default start has no off-by-one')
      assert.ok(step2.includes('2026-10-14'), 'default window example')
      assert.match(step2, /real calendar days/)
      assert.ok(step2.includes('`S` to `U` plus 1'), 'N counts both end days')
      assert.ok(step2.includes('`N` = 3'), 'previous period example has N = 3')
      assert.ok(stepText(6).includes('from the rounded values for the bug rate'), 'bug rate direction uses rounded values')
      assert.ok(text.includes('Add the `p85` next to the median.'), 'p85 sits next to the median')
      assert.ok(text.includes('- No events in the period: say so and show the numbers of the previous period.'), 'no-events edge case')
      assert.match(stepText(1) + text.split('## Parameters')[1].split('## Steps')[0], /14 when missing/)
    })

    test('the period calls use <S> and <U>, the previous calls use <previous S> and <previous U>, and aging takes only until', () => {
      for (const [n, since, until] of [[3, '<S>', '<U>'], [4, '<previous S>', '<previous U>']]) {
        for (const call of stepCalls(n)) {
          if (call.command === 'metrics aging') {
            assert.ok(call.text.includes(`--until ${until} `), `step ${n} aging ends at ${until}`)
            assert.ok(!call.text.includes('--since'), `step ${n} aging has no since`)
          } else {
            assert.ok(call.text.includes(`--since ${since} --until ${until} `), `step ${n} ${call.command} runs from ${since} to ${until}`)
          }
        }
      }
    })

    test('aging for a period that ends today is measured at the end of that day', () => {
      assert.match(text, /is today.{0,80}end of that day/)
    })

    test('the change is n/a for the medians and the bug rate only, and throughput always shows its difference', () => {
      const step6 = stepText(6)
      assert.match(step6, /n\/a.{0,60}cycle time, lead time or aging.{0,60}count of 0/)
      assert.match(step6, /bug rate.{0,60}`count` of 0/)
      assert.match(step6, /Throughput always shows its difference/)
    })

    test('step 1 names the manifest path in the source line for another source', () => {
      assert.match(stepText(1), /name the path from the manifest in the source line/)
    })

    test('the example table shows p85 as the text says', () => {
      const example = text.split('```text')[1].split('```')[0]
      assert.match(example, /p85 \d/)
    })

    test('has no parser note and no colon-led DORA sentence', () => {
      assert.ok(!text.includes('in its own sentence'))
      assert.ok(!text.includes('DORA metrics are not included:'))
    })
  })

  for (const { name, entries } of LOADED) {
    entries.forEach((scenario, index) => {
      const file = snapshotFile(name, index, entries.length)
      test(`scenario ${file.replace(/\.after\.txt$/, '')}`, async () => {
        const command = FILES.find((f) => f.name === scenarioName(scenario.command))
        assert.ok(command, `rule 1: scenario ${name} names commands/${scenario.command}.md, which does not exist`)
        assert.equal(scenarioName(scenario.command), name, `rule 1: scenario ${name}.mjs names ${scenario.command}; the module name must be ${scenarioName(scenario.command)}`)
        const siblings = siblingCoverage(entries, index, command.parsed, COMMANDS.map((c) => c.name))
        const { problems, snapshot } = await runScenario(scenario, {
          name, parsed: command.parsed, cliCommands: COMMANDS, fixturesDir: FIXTURES, inputsDir: INPUTS, siblings,
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

// PMK-163: a line right after a list item, with no blank line, that is not a list item and is indented less than the item's
// content column is a lazy continuation in CommonMark: it joins the item's paragraph. PMK-124 found two that were meant for the outer step.
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +)\S/
const NOT_PROSE = /^ *(```|~~~|\||#|>)/

/** The 1-based numbers of the lines that are an indented lazy continuation of the list item above them. */
function lazyContinuations(text) {
  const lines = text.split(/\r?\n/)
  const hits = []
  let fenced = false
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^ *(```|~~~)/.test(lines[i])) fenced = !fenced
    const item = fenced ? null : LIST_ITEM.exec(lines[i])
    if (!item) continue
    const next = lines[i + 1]
    if (next.trim() === '' || LIST_ITEM.test(next) || NOT_PROSE.test(next)) continue
    const indent = next.length - next.trimStart().length
    if (indent > 0 && indent < item[1].length + item[2].length + item[3].length) hits.push(i + 2)
  }
  return hits
}

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(full)
    return entry.name.endsWith('.md') ? [full] : []
  })
}

test('lazyContinuations finds an indented paragraph glued to the list item above it, and nothing else', () => {
  const step = '7. Draft the PR.\n   - When `existing` is `false`, show it.\n'
  assert.deepEqual(lazyContinuations(`${step}   When the user approves, run it.\n`), [3])
  assert.deepEqual(lazyContinuations(`${step}\n   When the user approves, run it.\n`), [])
  assert.deepEqual(lazyContinuations(`${step}     more of the same sub-item\n`), [])
  assert.deepEqual(lazyContinuations(`${step}   - another sub-item\n`), [])
  assert.deepEqual(lazyContinuations('```\n- item\n  glued\n```\n'), [])
  assert.deepEqual(lazyContinuations(`${step.replace(/\n/g, '\r\n')}   When the user approves, run it.\r\n`), [3])
})

test('no paragraph in commands, skills or docs is glued to the list item above it', () => {
  const root = path.join(HERE, '..')
  const found = ['commands', 'skills', 'docs'].flatMap((dir) => markdownFiles(path.join(root, dir)))
    .flatMap((file) => lazyContinuations(fs.readFileSync(file, 'utf8')).map((line) => `${path.relative(root, file)}:${line}`))
  assert.deepEqual(found, [], 'add a blank line before the paragraph, or indent it to the list item\'s text')
})

// PMK-156: the text of a numbered step, sub-items included, inside an optional `### <section>`.
function stepText(rel, step, section) {
  let text = fs.readFileSync(path.join(COMMANDS_DIR, rel), 'utf8')
  if (section) text = text.split(`\n### ${section}\n`)[1].split(/\n### /)[0]
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${step}. `))
  assert.ok(start >= 0, `${rel} has a step ${step}`)
  const end = lines.findIndex((line, i) => i > start && /^(\d+\. |#)/.test(line))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

test('local/doctor step 3 settles migration problems before any fix', () => {
  const step = stepText('local/doctor.md', '3')
  const bullet = step.split('\n').find((line) => line.startsWith('   - `migration` problems'))
  assert.ok(bullet, 'step 3 has a bullet for migration problems')
  assert.match(bullet, /this pmkit has no migration from tracker format/)
  assert.match(bullet, /\/pmkit:upgrade/)
  assert.match(bullet, /migration <n> to <m> failed: <reason>/)
  assert.match(bullet, /validate --json/)
  assert.match(bullet, /go to step 6/)
})

test('local/doctor step 3 checks the tracker folder before setting tracker.system to local', () => {
  const bullet = stepText('local/doctor.md', '3').split('\n').find((line) => line.startsWith('   - `config` problems'))
  assert.match(bullet, /is not supported yet, set it to local/)
  assert.match(bullet, /<tracker path>\/config\.yaml/)
  assert.match(bullet, /move `\.pmkit\/config\.yaml` aside and run `\/pmkit:setup`/)
})

test('setup Existing config step 2 reads the problems by code, and only config and conflict make init --update refuse', () => {
  const step = stepText('setup.md', '2', 'Existing config')
  assert.match(step, /`config` or `conflict`[^\n]*make `init --update` refuse/)
  assert.match(step, /`FORMAT` or `migration`[^\n]*do not stop the update/)
  assert.match(step, /\/pmkit:local:doctor/)
  assert.match(step, /\/pmkit:upgrade/)
  assert.doesNotMatch(step, /A problem in `\.issues\/config\.yaml` or `\.pmkit\/config\.yaml` makes `init --update` refuse/)
})

test('cycle/close step 3 leaves canceled issues out of the unfinished ones, as closeCycle does (PMK-165)', () => {
  const step = stepText('cycle/close.md', '3')
  assert.match(step, /`canceled`[^\n]*left out/)
  assert.match(step, /[Tt]he rest are unfinished/)
})

test('cycle/close step 6 asks whether an issue is the remaining work of an earlier split with AskUserQuestion (PMK-165)', () => {
  assert.match(stepText('cycle/close.md', '6'), /Ask with `AskUserQuestion` whether that issue is the remaining work of an earlier split/)
})

test('cycle/close says once what it does with an invalid .pmkit/config.yaml: a report, no proposal, no question (PMK-159)', () => {
  assert.match(stepText('cycle/close.md', '1'), /follow "An invalid `\.pmkit\/config\.yaml`" under "If something is missing"/)
  const text = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'close.md'), 'utf8')
  const bullet = text.split('\n## If something is missing\n')[1].split('\n').find((line) => line.startsWith('- An invalid `.pmkit/config.yaml`'))
  assert.ok(bullet, 'If something is missing has the bullet')
  for (const part of [/skip step 6/, /without a proposal or a question/, /pmkit validate/, /\/pmkit:local:doctor/, /stop/]) assert.match(bullet, part)
  assert.doesNotMatch(stepText('cycle/close.md', '1'), /Steps 2 to 6 only read, so go on with them/)
})

test('cycle/close marks a split\'s new issue with its origin and finds a half-done split by that mark (PMK-160)', () => {
  const calls = FILES.find((file) => file.rel === 'cycle/close.md').parsed.calls
  const create = calls.find((call) => call.step === '7' && call.command === 'issues create')
  assert.match(create.text, /--description-file <description file>/)
  assert.match(stepText('cycle/close.md', '7'), /Remaining work of <original id>, split when sprint <sprint id> closed\./)
  const search = calls.find((call) => call.step === '6' && call.command === 'issues list')
  assert.ok(search, 'step 6 searches for the mark')
  assert.match(search.text, /--text "split when sprint <sprint id> closed"/)
  assert.match(stepText('cycle/close.md', '8'), /estimate update only when step 7 kept it/)
})
