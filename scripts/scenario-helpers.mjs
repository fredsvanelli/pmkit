// Helpers for scripts/scenarios.test.mjs: the command file parser and the trace rules.
// Rule numbers refer to the checks in docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md.

/** The scenario module name of a command file: `issues/create` or `issues/create.md` gives `issues-create`. */
export const scenarioName = (rel) => rel.replace(/\.md$/, '').replace(/\//g, '-')

/** The snapshot file of entry `index` out of `count` entries of a module. */
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
    for (const match of line.matchAll(CALL)) calls.push(readCall(match[1], stepId(), section, cliNames))
  }
  return { calls, points }
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

/** Rule 9: each write and edit follows a confirm, and a write via dry run follows a dry run with the same args. */
export function orderProblems(trace) {
  const problems = []
  let confirmed = false
  const dryRuns = new Set()
  for (const row of trace) {
    if (row.kind === 'confirm') confirmed = true
    if (row.kind === 'dryRun') dryRuns.add(JSON.stringify(row.args))
    if (row.kind !== 'write' && row.kind !== 'edit') continue
    if (!confirmed) problems.push(`${describeRow(row)} comes before any confirm`)
    if (row.kind === 'write' && row.viaDryRun && !dryRuns.has(JSON.stringify(row.args))) {
      problems.push(`${describeRow(row)} repeats a dry run, but no earlier dry run has the same args`)
    }
  }
  return problems
}
