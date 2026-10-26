// Helpers for scripts/scenarios.test.mjs: the command file parser, the trace rules and the scenario runner.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { childEnv, displayArgs, makeNormalizer, quoteArg, runPmkit } from './golden-helpers.mjs'
import { addBareOrigin, fakeGh, ghCalls } from './fake-gh.mjs'
import { hashTree } from './test-helpers.mjs'
import { lineDiff } from './lib/diff.mjs'
import { parseYaml, splitFrontmatter } from './lib/yaml.mjs'

// Rule numbers refer to the checks in docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md.

/** The scenario module name of a command file: `issues/create` or `issues/create.md` gives `issues-create`. */
export const scenarioName = (rel) => rel.replace(/\.md$/, '').replace(/\//g, '-')

/**
 * The snapshot file of entry `index` out of `count` entries of a module. `index` is the position in the
 * exported array, from 0: an array of two gives `<name>.0.after.txt` and `<name>.1.after.txt`.
 */
export const snapshotFile = (name, index, count) => (count === 1 ? `${name}.after.txt` : `${name}.${index}.after.txt`)

/** The key rule 6 counts calls by. */
export const callKey = (call) => `${call.step} ${call.command}`

const SECTIONS = { Steps: 'steps', 'If something is missing': 'missing' }
const CALL = /pmkit\.mjs" +([^`]*)/g
// A flag token, a bracket that opens or closes an optional part, or a quoted value to skip.
const FLAG_TOKEN = /\[|\]|"[^"]*"|(?<![\w-])--([a-z][\w-]*)/gi
// A placeholder that stands for any number of flags, such as `<flags>` or `<fields>`.
const ANY_FLAGS = /^<[^<>]*\b(?:flags|fields)>$/

/** The CLI command named by the first words of a call or an entry: two words when they name a command, else one. */
function commandOf(words, cliNames) {
  const two = words.slice(0, 2).join(' ')
  return cliNames.includes(two) ? two : words[0]
}

function readCall(rest, step, section, cliNames) {
  const text = rest.trim()
  const flags = []
  const optional = []
  let depth = 0
  for (const match of text.matchAll(FLAG_TOKEN)) {
    if (match[0] === '[') depth++
    else if (match[0] === ']') depth = Math.max(0, depth - 1)
    else if (match[1] && !flags.includes(match[1])) {
      flags.push(match[1])
      if (depth > 0) optional.push(match[1])
    }
  }
  const words = text.split(/\s+/)
  return {
    step,
    section,
    command: commandOf(words, cliNames),
    flags,
    optional,
    anyFlags: words.some((word) => ANY_FLAGS.test(word)),
    dryRun: flags.includes('dry-run'),
    endsWithJson: /(?:^|\s)--json$/.test(text),
    text,
  }
}

/** The label of a confirmation bullet: the text before the first `: ` outside backticks, or null for a note. */
function pointLabel(body) {
  let code = false
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] === '`') code = !code
    else if (!code && body[i] === ':' && body[i + 1] === ' ') return body.slice(0, i).trim() || null
  }
  return null
}

/**
 * Reads the `pmkit.mjs` calls and the confirmation points of a command file.
 * Step ids: `N` for a top-level item, `N.M` for a nested one, `N` for every item under `### N. Title`,
 * `<heading> <id>` under a heading without a number, and `missing` under "If something is missing".
 * A `-` bullet belongs to the numbered item above it.
 */
export function parseCommandFile(text, cliNames) {
  const calls = []
  const points = []
  let sectionName = ''
  let section = 'other'
  let headingNumber = null
  let headingPrefix = null
  let items = []
  let fence = false
  const proseFlags = []

  const stepId = () => {
    if (section === 'missing') return 'missing'
    if (section !== 'steps') return ''
    if (headingNumber) return headingNumber
    const ids = items.map((item) => item.number).join('.')
    if (headingPrefix) return ids ? `${headingPrefix} ${ids}` : headingPrefix
    return ids
  }

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      continue
    }
    if (!fence) {
      const heading = line.match(/^(#{1,3}) +(.*?)\s*$/)
      const item = line.match(/^(\s*)(\d+)\. /)
      const bullet = line.match(/^(\s*)[-*] /)
      if (heading) {
        items = []
        if (heading[1] === '###') {
          const numbered = heading[2].match(/^(\d+)\. /)
          headingNumber = numbered ? numbered[1] : null
          headingPrefix = numbered ? null : heading[2]
        } else {
          sectionName = heading[1] === '##' ? heading[2] : ''
          section = SECTIONS[sectionName] ?? 'other'
          headingNumber = null
          headingPrefix = null
        }
        continue
      }
      if (item) {
        const indent = item[1].length
        while (items.length && items.at(-1).indent >= indent) items.pop()
        items.push({ indent, number: item[2] })
      } else if (bullet) {
        const indent = bullet[1].length
        while (items.length > 1 && items.at(-1).indent >= indent) items.pop()
      } else if (/^\S/.test(line)) {
        items = []
      }
      if (sectionName === 'Confirmation points' && /^- /.test(line)) {
        const label = pointLabel(line.slice(2))
        if (label && !points.includes(label)) points.push(label)
      }
    }
    let prose = line
    const here = []
    for (const match of line.matchAll(CALL)) {
      const call = readCall(match[1], stepId(), section, cliNames)
      calls.push(call)
      here.push({ at: match.index, count: calls.length })
      prose = prose.replace(match[0], ' '.repeat(match[0].length))
    }
    if (fence) continue
    for (const flag of prose.matchAll(/`--([a-z][\w-]*)[^`]*`/gi)) {
      // `before` counts the calls that precede the flag, so the post-pass can look backward and then forward.
      const before = here.filter((entry) => entry.at < flag.index).at(-1)?.count ?? calls.length - here.length
      proseFlags.push({ name: flag[1], step: stepId(), section, before })
    }
  }
  // A flag named only in the prose of a step, such as "or `--type <value>`", belongs to the last call before it
  // in the same step, else to the first call after it. A flag with no call to join is returned in `looseFlags`.
  // `--dry-run` in prose never marks a call as a preview, so it is skipped.
  const looseFlags = []
  for (const { name, step, section: where, before } of proseFlags) {
    if (name === 'dry-run') continue
    const same = (call) => call.step === step && call.section === where
    const owner = calls.slice(0, before).findLast(same) ?? calls.slice(before).find(same)
    if (!owner) looseFlags.push({ step, section: where, flag: name })
    else if (!owner.flags.includes(name)) {
      owner.flags.push(name)
      owner.optional.push(name)
    }
  }
  return { calls, points, looseFlags }
}

/** Rule 3: the flags of a call that its CLI command does not take. */
export function unknownFlags(call, cliCommand) {
  const allowed = new Set(['json', 'root', ...(cliCommand?.flags ?? []), ...(cliCommand?.booleans ?? [])])
  if (cliCommand?.write || cliCommand?.dryRun) allowed.add('dry-run')
  if (cliCommand?.write) allowed.add('as')
  return call.flags.filter((flag) => !allowed.has(flag))
}

const describeEntry = (entry) => `${entry.kind} [step ${entry.step}] ${entry.args.join(' ')}`

/** Rule 5: the call of the entry's step that the entry runs, or an error naming the entry. */
export function matchEntry(entry, calls, cliNames) {
  const name = describeEntry(entry)
  const reserved = entry.args.filter((arg) => arg === '--json' || arg === '--dry-run')
  if (reserved.length) return { error: `${name}: args must not contain ${reserved.join(' ')}; the runner adds them` }
  const command = commandOf(entry.args, cliNames)
  const inStep = calls.filter((call) => call.section !== 'other' && call.step === entry.step && call.command === command)
  if (!inStep.length) return { error: `${name}: step ${entry.step} has no call of \`${command}\`` }
  const plain = inStep.filter((call) => !call.dryRun)
  const dry = inStep.filter((call) => call.dryRun)
  let candidates = plain
  let viaDryRun = false
  if (entry.kind === 'dryRun') candidates = dry
  else if (entry.kind === 'write' && !plain.length) [candidates, viaDryRun] = [dry, true]
  if (!candidates.length) {
    const wanted = entry.kind === 'dryRun' ? 'with --dry-run' : 'without --dry-run'
    return { error: `${name}: step ${entry.step} has no call of \`${command}\` ${wanted}` }
  }
  const flags = entry.args.filter((arg) => arg.startsWith('--')).map((arg) => arg.slice(2).split('=')[0])
  const missing = (call) => (call.anyFlags ? [] : flags.filter((flag) => !call.flags.includes(flag)))
  const match = candidates.find((call) => !missing(call).length)
  if (!match) {
    const absent = missing(candidates[0]).map((flag) => `--${flag}`).join(' ')
    return { error: `${name}: the call \`${candidates[0].text}\` has no ${absent}` }
  }
  return { key: callKey(match), viaDryRun }
}

/** Rule 6: call keys of the procedure that no entry uses and no skip excuses, and stale or empty skips. */
export function coverageProblems(calls, usedKeys, skip) {
  const keys = [...new Set(calls.filter((call) => call.section !== 'other').map(callKey))]
  const problems = keys
    .filter((key) => !usedKeys.has(key) && !(key in skip))
    .map((key) => `call \`${key}\` is not used by any entry and not in skip`)
  for (const [key, reason] of Object.entries(skip)) {
    if (typeof reason !== 'string' || !reason.trim()) problems.push(`skip \`${key}\` needs a non-empty reason`)
    if (!keys.includes(key)) problems.push(`skip \`${key}\` matches no call of the command file`)
  }
  return problems
}

/** Rules 7 and 10: the confirmation points of the file against the confirms and notHit of a scenario. */
export function pointProblems(points, confirmed, notHit) {
  const problems = points
    .filter((point) => !confirmed.includes(point) && !(point in notHit))
    .map((point) => `confirmation point \`${point}\` is neither confirmed nor in notHit`)
  for (const key of new Set(confirmed)) {
    if (!points.includes(key)) problems.push(`confirm \`${key}\` is not a confirmation point of the command file`)
  }
  for (const [key, reason] of Object.entries(notHit)) {
    if (!points.includes(key)) problems.push(`notHit \`${key}\` is not a confirmation point of the command file`)
    else if (confirmed.includes(key)) problems.push(`notHit \`${key}\` is also confirmed`)
    if (typeof reason !== 'string' || !reason.trim()) problems.push(`notHit \`${key}\` needs a non-empty reason`)
  }
  return problems
}

const describeRow = (row) => `${row.kind} [step ${row.step}]${row.args ? ` ${row.args.join(' ')}` : ''}`

/**
 * Rule 9: each write and edit follows a confirm, and a write via dry run follows a dry run with the same args.
 * Rows keep the entry args, without the `--json` and `--dry-run` the runner adds, so the two compare.
 */
export function orderProblems(trace) {
  const problems = []
  let confirmed = false
  const dryRuns = new Set()
  for (const row of trace) {
    if (row.kind === 'confirm') confirmed = true
    // A dry run that failed as expected previewed nothing, so it covers no write.
    if (row.kind === 'dryRun' && !row.expectError) dryRuns.add(JSON.stringify(row.args))
    if (row.kind !== 'write' && row.kind !== 'edit') continue
    if (!confirmed) problems.push(`${describeRow(row)} comes before any confirm`)
    if (row.kind === 'write' && row.viaDryRun && !dryRuns.has(JSON.stringify(row.args))) {
      problems.push(`${describeRow(row)} repeats a dry run, but no earlier dry run has the same args`)
    }
  }
  return problems
}

/** Rule 1: command names without a scenario, scenario names without a command, and pending names that have a scenario. */
export function compareScenarios(commandNames, scenarioNames, pending) {
  const commands = new Set(commandNames)
  const scenarios = new Set(scenarioNames)
  return {
    missing: commandNames.filter((name) => !scenarios.has(name) && !pending.has(name)),
    extra: scenarioNames.filter((name) => !commands.has(name)),
    pendingWithScenario: [...pending].filter((name) => scenarios.has(name)),
  }
}

/** Rule 2: snapshot files that match no entry, sorted. `_inputs` and `*.mjs` are skipped. */
export function staleSnapshots(files, expected) {
  const known = new Set(expected)
  return files.filter((file) => file !== '_inputs' && !file.endsWith('.mjs') && !known.has(file)).sort()
}

/** Loads every scenario module of `dir`: an array export gives several entries, an object one. */
export async function loadScenarios(dir) {
  const names = fs.readdirSync(dir).filter((file) => file.endsWith('.mjs')).map((file) => file.slice(0, -4)).sort()
  const loaded = []
  for (const name of names) {
    const { default: exported } = await import(pathToFileURL(path.join(dir, `${name}.mjs`)).href)
    loaded.push({ name, entries: Array.isArray(exported) ? exported : [exported] })
  }
  return loaded
}

/** Every file under `dir` except the top-level names in `skip`, as posix relative path to UTF-8 text. */
export function readTree(dir, skip = ['.git']) {
  const files = new Map()
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (current === dir && skip.includes(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'))
    }
  }
  walk(dir)
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)))
}

const diffLines = (before, after) => lineDiff(before, after).split('\n').slice(0, -1)

/** The snapshot lines for the files that differ between two trees, sorted by path. */
export function treeChanges(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()
  const lines = []
  for (const file of paths) {
    if (!after.has(file)) lines.push(`--- removed ${file}`)
    else if (!before.has(file)) lines.push(`--- added ${file}`, ...diffLines('', after.get(file)))
    else if (before.get(file) !== after.get(file)) lines.push(`--- changed ${file}`, ...diffLines(before.get(file), after.get(file)))
  }
  return lines.length ? lines : ['(no file changed)']
}

/**
 * The snapshot text: trace rows, a blank line, the file changes, then the gh calls when `gh` is a list.
 * Every line loses its trailing whitespace (an empty context line of `lineDiff` is two spaces), so an editor
 * that trims on save cannot break rule 12.
 */
export function formatSnapshot({ rows, changes, gh }) {
  const lines = [...rows, '', ...changes]
  if (gh) lines.push('--- gh calls', ...(gh.length ? gh : ['(none)']))
  return `${lines.map((line) => line.trimEnd()).join('\n')}\n`
}

const HARNESS_GIT = ['-c', 'user.name=pmkit', '-c', 'user.email=pmkit@example.com']

function runGit(root, args, env) {
  return spawnSync('git', [...HARNESS_GIT, ...args], { cwd: root, env, encoding: 'utf8' })
}

function gitOrThrow(root, args, env) {
  const result = runGit(root, args, env)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  return result.stdout
}

/** The event log of an issue or epic that exists now or existed at the baseline. */
const eventLog = (root, baseline, id) => ['issues', 'epics']
  .map((kind) => `.issues/${kind}/${id}/events.jsonl`)
  .find((rel) => baseline.has(rel) || fs.existsSync(path.join(root, rel)))

/** What `expect(repo)` reads: records parsed from the copy, events appended after the baseline, gh calls and git. */
export function makeRepoView(root, baseline, gh, env = childEnv()) {
  const file = (rel) => {
    const full = path.join(root, rel)
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
  }
  const frontmatter = (rel) => {
    const text = file(rel)
    if (text === null) throw new Error(`${rel} does not exist`)
    return parseYaml(splitFrontmatter(text).yaml)
  }
  return {
    issue: (id) => frontmatter(`.issues/issues/${id}/issue.md`),
    epic: (id) => frontmatter(`.issues/epics/${id}/epic.md`),
    sprint(id) {
      const text = file(`.issues/sprints/${id}.yaml`)
      if (text === null) throw new Error(`sprint ${id} does not exist`)
      return parseYaml(text)
    },
    file,
    newEvents(id) {
      const rel = eventLog(root, baseline, id)
      if (!rel) return []
      const before = baseline.get(rel) ?? ''
      const after = file(rel)
      if (after === null) throw new Error(`${rel} was deleted`)
      if (!after.startsWith(before)) throw new Error(`${rel} was rewritten, not appended to`)
      return after.slice(before.length).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    },
    ghCalls: () => (gh ? ghCalls(gh) : []),
    git: (...args) => gitOrThrow(root, args, env),
  }
}

const KINDS = ['read', 'dryRun', 'write', 'confirm', 'edit', 'git']
const LABELS = { read: 'read', dryRun: 'dry run', write: 'write' }

/**
 * Copies the fixture into `root` and applies `github` and `git`. Returns the fake gh handle, or null.
 * For `github`, it also puts the fake gh first on `env.PATH` and sets `env.PMKIT_FAKE_GH`.
 */
function prepareCopy(scenario, { root, scratch, fixturesDir, env }) {
  if (scenario.fixture) fs.cpSync(path.join(fixturesDir, scenario.fixture), root, { recursive: true })
  else fs.mkdirSync(root)
  if (scenario.github) {
    const config = path.join(root, '.pmkit', 'config.yaml')
    const text = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : ''
    if (!text.includes('system: none')) throw new Error('github: .pmkit/config.yaml has no `system: none` line to turn into github')
    fs.writeFileSync(config, text.replace('system: none', 'system: github\n  default_branch: main'))
  }
  if (scenario.git || scenario.github) {
    gitOrThrow(root, ['init', '-q', '-b', 'main'], env)
    gitOrThrow(root, ['add', '-A'], env)
    gitOrThrow(root, ['commit', '-q', '--allow-empty', '-m', 'initial'], env)
  }
  if (!scenario.github) return null
  const remote = path.join(scratch, 'origin.git')
  fs.mkdirSync(remote)
  addBareOrigin(root, remote, env)
  const ghDir = path.join(scratch, 'gh')
  fs.mkdirSync(ghDir)
  const gh = fakeGh(scenario.gh ?? {}, ghDir)
  env.PATH = `${ghDir}${path.delimiter}${env.PATH}`
  env.PMKIT_FAKE_GH = gh.responses
  return gh
}

const parseJson = (text) => {
  try {
    return { json: JSON.parse(text) }
  } catch {
    return { json: undefined }
  }
}

/**
 * Runs one scenario entry on a fresh copy of its fixture and applies rules 5 to 11.
 * Returns the problems and the snapshot (null when an entry could not run). Each problem starts with
 * `rule N:`, or with `runner:` when the scenario itself cannot run (an unknown entry kind, a failing args
 * function, a failing `git` entry or write). `run` replaces `runPmkit`, for the rule 8 tests.
 * Rule 8 compares `hashTree`, which hashes file paths and contents: a new empty folder or a mode change passes.
 */
export async function runScenario(scenario, { name, parsed, cliCommands, fixturesDir, inputsDir, run = runPmkit }) {
  const cliNames = cliCommands.map((command) => command.name)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-scn-'))
  const root = path.join(scratch, 'repo')
  const env = childEnv()
  const problems = []
  const rows = []
  const trace = []
  const usedKeys = new Set()
  const confirmed = []
  const saved = {}
  const show = (args) => displayArgs(args, { root, inputs: inputsDir }).map(quoteArg).join(' ')
  try {
    const gh = prepareCopy(scenario, { root, scratch, fixturesDir, env })
    const pmkit = async (args, { stdin } = {}) => {
      const result = await run([...args, '--json'], root, { env, input: stdin })
      if (result.code !== 0) throw new Error(`setup: pmkit ${args.join(' ')} exited ${result.code}: ${result.stdout}${result.stderr}`)
      return JSON.parse(result.stdout)
    }
    await scenario.setup?.({ root, pmkit, git: (...args) => gitOrThrow(root, args, env) })
    const baseline = readTree(root)

    let stopped = false
    for (const entry of scenario.steps) {
      const kind = KINDS.find((k) => k in entry)
      if (kind === 'confirm') {
        confirmed.push(entry.confirm)
        trace.push({ kind, key: entry.confirm })
        rows.push(`? ${entry.confirm}  [confirmed]`)
        continue
      }
      if (kind === 'edit') {
        fs.mkdirSync(path.dirname(path.join(root, entry.edit.file)), { recursive: true })
        fs.writeFileSync(path.join(root, entry.edit.file), entry.edit.content)
        trace.push({ kind, step: entry.step })
        rows.push(`~ edit ${entry.edit.file}  [step ${entry.step}]`)
        continue
      }
      if (!kind) {
        problems.push(`runner: ${name}: entry ${JSON.stringify(entry)} has none of ${KINDS.join(', ')}`)
        stopped = true
        break
      }
      let args
      try {
        args = typeof entry[kind] === 'function' ? entry[kind](saved) : entry[kind]
      } catch (error) {
        problems.push(`runner: ${kind} [step ${entry.step}]: args function failed: ${error.message}`)
        stopped = true
        break
      }
      const label = `${kind} [step ${entry.step}] ${args.join(' ')}`
      if (kind === 'git') {
        const result = runGit(root, args, env)
        rows.push(`$ git ${show(args)}  [step ${entry.step}, git]`, `exit ${result.status}`)
        if (result.status !== 0) {
          problems.push(`runner: ${label} exited ${result.status}: ${result.stderr}`)
          stopped = true
          break
        }
        continue
      }

      const match = matchEntry({ ...entry, kind, args }, parsed.calls, cliNames)
      if (match.error) problems.push(`rule 5: ${match.error}`)
      else usedKeys.add(match.key)
      const reads = kind !== 'write'
      const before = reads ? hashTree(root, ['.git']) : null
      const full = kind === 'dryRun' ? [...args, '--dry-run', '--json'] : [...args, '--json']
      const result = await run(full, root, { env, input: entry.stdin })
      const { json } = parseJson(result.stdout)
      rows.push(`$ pmkit ${show(full)}  [step ${entry.step}, ${LABELS[kind]}]`)
      rows.push(entry.expectError ? `exit ${result.code} (expected ${entry.expectError})` : `exit ${result.code}`)
      trace.push({ kind, step: entry.step, args, key: match.key, viaDryRun: match.viaDryRun, expectError: entry.expectError })
      if (reads && json === undefined) problems.push(`rule 8: ${label} did not print JSON on stdout`)
      if (reads && hashTree(root, ['.git']) !== before) problems.push(`rule 8: ${label} changed the files of the copy outside .git`)
      if (entry.save) saved[entry.save] = json
      const failure = entry.expectError
        ? (result.code === 0 || json?.error?.code !== entry.expectError) && `did not fail with ${entry.expectError}`
        : result.code !== 0 && `exited ${result.code}`
      if (failure) {
        problems.push(`${reads ? 'rule 8' : 'runner'}: ${label} ${failure}: ${result.stdout}${result.stderr}`.trim())
        stopped = true
        break
      }
    }

    problems.push(...orderProblems(trace).map((problem) => `rule 9: ${problem}`))
    if (stopped) return { problems, snapshot: null }
    problems.push(...coverageProblems(parsed.calls, usedKeys, scenario.skip ?? {}).map((problem) => `rule 6: ${problem}`))
    problems.push(...pointProblems(parsed.points, confirmed, scenario.notHit ?? {})
      .map((problem) => `rule ${problem.startsWith('confirm ') ? 10 : 7}: ${problem}`))
    try {
      await scenario.expect?.(makeRepoView(root, baseline, gh, env), saved)
    } catch (error) {
      problems.push(`rule 11: expect failed: ${error.message}`)
    }
    const changes = treeChanges(baseline, readTree(root))
    const normalize = makeNormalizer({ root, inputs: inputsDir })
    const snapshot = normalize(formatSnapshot({ rows, changes, gh: gh ? ghCalls(gh) : null }))
    for (const leak of [scratch, fs.realpathSync(scratch), 'pmkit-scn-']) {
      if (snapshot.includes(leak)) problems.push(`rule 12: the snapshot holds the scratch path ${leak}`)
    }
    return { problems, snapshot }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}
