// Security alerts from the scanners the repository already has. See
// docs/superpowers/specs/2026-10-30-pmk-48-local-security-alerts-design.md.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** The severity of an alert, highest first. `unknown` is a scanner that gives none (pip-audit) or none pmkit can read. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown']

const NPM_SEVERITY = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'low' }

/** The error of a scanner that printed nothing, with its stderr collapsed and cut at 300 characters. */
export function emptyOutputError(label, stderr) {
  const detail = String(stderr ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  return new Error(detail === '' ? `${label} printed empty output` : `${label} printed empty output: ${detail}`)
}

/** Parses the stdout of `npm audit --json` (report version 2). Throws an Error when it is not an audit report. */
export function parseNpmAudit(stdout, stderr = '') {
  if (!stdout || stdout.trim() === '') throw emptyOutputError('npm audit', stderr)
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    throw new Error('npm audit output is not valid JSON')
  }
  // npm prints { message, error: { code, summary, detail } } when it cannot audit, for example without a lockfile.
  if (report && typeof report === 'object' && report.error && typeof report.error === 'object') {
    const code = report.error.code ? ` (${report.error.code})` : ''
    throw new Error(`npm audit failed${code}: ${report.message ?? report.error.summary ?? 'no message'}`)
  }
  if (!report || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error('npm audit output has no vulnerabilities object')
  }
  const warnings = []
  const alerts = Object.entries(report.vulnerabilities).map(([key, entry]) => {
    const name = entry.name ?? key
    let severity = NPM_SEVERITY[entry.severity]
    if (severity === undefined) {
      warnings.push(`npm-audit: ${name} has the unknown severity "${entry.severity}", treated as low`)
      severity = 'low'
    }
    const via = Array.isArray(entry.via) ? entry.via : []
    const objects = via.filter((item) => item !== null && typeof item === 'object')
    // The title and URL come from the advisory that has the alert's severity, else the most severe one, the first on a tie.
    const advisoryRank = (item) => SEVERITIES.indexOf(NPM_SEVERITY[item.severity] ?? 'low')
    const advisory = objects.find((item) => NPM_SEVERITY[item.severity] === severity)
      ?? objects.reduce((best, item) => (best === undefined || advisoryRank(item) < advisoryRank(best) ? item : best), undefined)
    const names = via.filter((item) => typeof item === 'string')
    return {
      id: `npm-audit:${name}`,
      scanner: 'npm-audit',
      package: name,
      title: advisory?.title ?? (names.length > 0 ? `vulnerable through ${names.join(', ')}` : 'no advisory details from npm audit'),
      severity,
      url: advisory?.url ?? null,
      fixAvailable: Boolean(entry.fixAvailable),
      advisories: objects.map((item) => ({ title: item.title ?? null, url: item.url ?? null })),
    }
  })
  return { alerts, warnings }
}

/** The severity of an npm-style name (npm, yarn, pnpm). An unknown name is low, with a warning. */
function npmStyleSeverity(scanner, name, value, warnings) {
  const severity = NPM_SEVERITY[value]
  if (severity !== undefined) return severity
  warnings.push(`${scanner}: ${name} has the unknown severity "${value}", treated as low`)
  return 'low'
}

/**
 * One alert per package from a list of advisories, each `{ package, severity, title, url, fixAvailable }` with a pmkit
 * severity. The alert has the highest severity of its advisories, the title and URL of the first advisory with it, and a
 * fix only when every advisory has one. The same advisory on two dependency paths counts once. Keeps the first-seen order.
 */
export function groupAdvisories(scanner, entries) {
  const byPackage = new Map()
  for (const entry of entries) {
    if (!byPackage.has(entry.package)) byPackage.set(entry.package, [])
    const list = byPackage.get(entry.package)
    if (!list.some((seen) => seen.title === entry.title && seen.url === entry.url)) list.push(entry)
  }
  return [...byPackage].map(([name, list]) => {
    const top = list.reduce((best, item) => (SEVERITIES.indexOf(item.severity) < SEVERITIES.indexOf(best.severity) ? item : best))
    return {
      id: `${scanner}:${name}`, scanner, package: name, title: top.title, severity: top.severity, url: top.url,
      fixAvailable: list.every((item) => item.fixAvailable), advisories: list.map((item) => ({ title: item.title, url: item.url })),
    }
  })
}

/** An advisory in the npm v6 shape that yarn classic and pnpm print, as a groupAdvisories entry. `<0.0.0` means no patch. */
function npmStyleAdvisory(scanner, advisory, warnings) {
  const name = String(advisory.module_name)
  const patched = typeof advisory.patched_versions === 'string' ? advisory.patched_versions.trim() : ''
  return {
    package: name, severity: npmStyleSeverity(scanner, name, advisory.severity, warnings),
    title: advisory.title ?? 'no advisory title', url: advisory.url ?? null, fixAvailable: patched !== '' && patched !== '<0.0.0',
  }
}

/** Parses the NDJSON stdout of yarn classic `yarn audit --json`. Throws an Error when it is not an audit report. */
export function parseYarnAudit(stdout, stderr = '') {
  if (!stdout || stdout.trim() === '') throw emptyOutputError('yarn audit', stderr)
  const lines = []
  for (const text of stdout.split(/\r?\n/)) {
    if (text.trim() === '') continue
    try {
      lines.push(JSON.parse(text))
    } catch {
      // yarn prints plain text when it fails before the audit, for example Yarn Berry without the command.
    }
  }
  const error = lines.find((line) => line?.type === 'error')
  if (error) throw new Error(`yarn audit failed: ${String(error.data ?? 'no message').replace(/\s+/g, ' ').trim()}`)
  const advisories = lines.filter((line) => line?.type === 'auditAdvisory' && line.data?.advisory?.module_name !== undefined)
  if (advisories.length === 0 && !lines.some((line) => line?.type === 'auditSummary')) throw new Error('yarn audit printed no audit report')
  const warnings = []
  const alerts = groupAdvisories('yarn-audit', advisories.map((line) => npmStyleAdvisory('yarn-audit', line.data.advisory, warnings)))
  return { alerts, warnings: [...new Set(warnings)] }
}

/** Parses the stdout of `pnpm audit --json` (the npm v6 report shape). Throws an Error when it is not an audit report. */
export function parsePnpmAudit(stdout, stderr = '') {
  if (!stdout || stdout.trim() === '') throw emptyOutputError('pnpm audit', stderr)
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    throw new Error('pnpm audit output is not valid JSON')
  }
  if (report && typeof report.error === 'object' && report.error !== null) {
    const code = report.error.code ? ` (${report.error.code})` : ''
    throw new Error(`pnpm audit failed${code}: ${report.error.message ?? 'no message'}`)
  }
  if (!report || typeof report.advisories !== 'object' || report.advisories === null) throw new Error('pnpm audit output has no advisories object')
  const warnings = []
  const entries = Object.values(report.advisories).filter((advisory) => advisory?.module_name !== undefined)
  return { alerts: groupAdvisories('pnpm-audit', entries.map((advisory) => npmStyleAdvisory('pnpm-audit', advisory, warnings))), warnings: [...new Set(warnings)] }
}

/** The most output one scanner may print, in bytes. The same limit as the GitHub host. */
export const NPM_MAX_BUFFER = 256 * 1024 * 1024
/** The longest one scanner may run, in milliseconds. */
export const NPM_TIMEOUT_MS = 60000

/** A Node package manager's executable name: Windows needs the .cmd shim, which spawnSync does not resolve on its own. */
export const shimCommand = (name, platform = process.platform) => (platform === 'win32' ? `${name}.cmd` : name)
/** The npm executable name. */
export const npmCommand = (platform = process.platform) => shimCommand('npm', platform)

/**
 * True when the shell could not find npm.cmd. cmd.exe exits with 9009 for an unknown command in every display language,
 * so the exit code is the main test. The English "is not recognized" text on stderr is the fallback. Only when stdout is
 * blank: an audit report on stdout means npm ran, whatever its exit code and stderr say.
 */
export const isNpmMissingOnShell = (result) => (result.stdout ?? '').trim() === ''
  && (result.status === 9009 || (result.status !== 0 && /is not recognized/i.test(result.stderr ?? '')))

/**
 * Runs one scanner and returns its stdout and stderr, whatever its exit code: the scanners exit non-zero when they find
 * vulnerabilities. `shim` names a Node package manager (npm, yarn, pnpm): on Windows it is a .cmd file, and Node refuses
 * to spawn one without a shell (EINVAL), so the call goes through cmd.exe. Throws an Error that names the cause.
 */
export function runScanner(name, args, { root, env, timeoutMs, platform, spawn, shim = false, label }) {
  const viaShell = shim && platform === 'win32'
  const result = spawn(shim ? shimCommand(name, platform) : name, args, { cwd: root, env, encoding: 'utf8', maxBuffer: NPM_MAX_BUFFER, timeout: timeoutMs, shell: viaShell })
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error(`${name} is not installed or not on PATH`)
    if (result.error.code === 'ETIMEDOUT') throw new Error(`${label} timed out after ${timeoutMs / 1000} s`)
    if (result.error.code === 'ENOBUFS') throw new Error(`${label} printed more than ${NPM_MAX_BUFFER / 1024 / 1024} MiB`)
    throw new Error(result.error.message)
  }
  // With the shell, a missing .cmd exits non-zero and does not raise ENOENT.
  if (viaShell && isNpmMissingOnShell(result)) throw new Error(`${name} is not installed or not on PATH`)
  return { stdout: result.stdout, stderr: result.stderr }
}

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json']

/**
 * The scanners, in the order they run. `detect` says whether the repository has the scanner, `command` and `args` run it,
 * `shim` marks a Node package manager (see runScanner), and `parse(stdout, stderr)` reads its JSON output, run or saved.
 */
export const SCANNERS = [
  {
    id: 'npm-audit', label: 'npm audit', needs: LOCKFILES.join(' or '),
    detect: (root) => LOCKFILES.some((file) => fs.existsSync(path.join(root, file))),
    command: 'npm', args: ['audit', '--json'], shim: true, parse: parseNpmAudit,
  },
  {
    id: 'yarn-audit', label: 'yarn audit', needs: 'yarn.lock',
    detect: (root) => fs.existsSync(path.join(root, 'yarn.lock')),
    command: 'yarn', args: ['audit', '--json'], shim: true, parse: parseYarnAudit,
  },
  {
    id: 'pnpm-audit', label: 'pnpm audit', needs: 'pnpm-lock.yaml',
    detect: (root) => fs.existsSync(path.join(root, 'pnpm-lock.yaml')),
    command: 'pnpm', args: ['audit', '--json'], shim: true, parse: parsePnpmAudit,
  },
]

const rank = (alert) => SEVERITIES.indexOf(alert.severity)

/**
 * Runs every scanner the repository at `root` has. A scanner that fails is reported in `scanners` and `warnings`,
 * never thrown. Alerts sort by severity, then package.
 */
export function collectAlerts(root, { env = process.env, timeoutMs = NPM_TIMEOUT_MS, platform = process.platform, spawn = spawnSync } = {}) {
  const scanners = []
  const alerts = []
  const warnings = []
  for (const scanner of SCANNERS) {
    if (!scanner.detect(root)) {
      scanners.push({ id: scanner.id, detected: false, alerts: 0 })
      continue
    }
    try {
      const { stdout, stderr } = runScanner(scanner.command, scanner.args, { root, env, timeoutMs, platform, spawn, shim: scanner.shim, label: scanner.label })
      const found = scanner.parse(stdout, stderr)
      alerts.push(...found.alerts)
      warnings.push(...found.warnings)
      scanners.push({ id: scanner.id, detected: true, alerts: found.alerts.length })
    } catch (error) {
      scanners.push({ id: scanner.id, detected: true, alerts: 0, error: error.message })
      warnings.push(`${scanner.id} failed: ${error.message}`)
    }
  }
  alerts.sort((a, b) => rank(a) - rank(b) || a.package.localeCompare(b.package))
  return { scanners, alerts, warnings }
}

// ---- Turning alerts into issues (PMK-73) ----

/** The longest issue title, in characters. */
const MAX_TITLE = 120

/**
 * The stable key of an alert: the scanner and the package, nothing else. The advisories, their order, their titles and
 * the packages an advisory goes through change when the user fixes a dependency, and a changed key would open a second
 * issue for the same package.
 */
export const alertKey = (alert) => crypto.createHash('sha256').update(`${alert.scanner}\n${alert.package}`).digest('hex').slice(0, 12)

/** The names a severity matches in the tracker priorities, before the position is used. */
const PRIORITY_NAMES = { critical: ['urgent', 'critical'], high: ['high'], medium: ['medium', 'normal'], low: ['low'] }

/**
 * The tracker priority of a severity. The name comes first: critical is `urgent` or `critical`, high is `high`, medium is
 * `medium` or `normal`, low is `low`. With no such name the position decides: critical is the first priority, high the
 * second, medium the third and low the last, clamped to the list. `none` is never used. An empty list gives null, and so
 * does the `unknown` severity: the command asks for a priority rather than make one up.
 */
export function priorityFor(severity, priorities) {
  if (severity === 'unknown') return null
  const usable = priorities.filter((name) => name.toLowerCase() !== 'none')
  if (usable.length === 0) return null
  const named = (PRIORITY_NAMES[severity] ?? []).map((wanted) => usable.find((name) => name.toLowerCase() === wanted)).find(Boolean)
  if (named) return named
  const last = usable.length - 1
  const position = severity === 'low' ? last : SEVERITIES.indexOf(severity)
  return usable[position < 0 ? last : Math.min(position, last)]
}

/** The issue an alert becomes. `priorities` and `types` come from the tracker. The description ends with the `alert-key:` line. */
export function alertCandidate(alert, { priorities, types }) {
  const key = alertKey(alert)
  // An advisory title can hold line breaks; `--title-file` rejects a title of more than one line.
  const title = `Security: ${alert.package}: ${alert.title}`.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
  const description = [
    alert.title, '',
    `Severity: ${alert.severity}`, `Package: ${alert.package}`, `Scanner: ${alert.scanner}`,
    `Advisory: ${alert.url ?? 'none'}`, `Fix available: ${alert.fixAvailable ? 'yes' : 'no'}`, '',
    `alert-key: ${key}`, '',
  ].join('\n')
  return {
    key, id: alert.id, scanner: alert.scanner, package: alert.package, severity: alert.severity,
    priority: priorityFor(alert.severity, priorities), type: types.includes('bug') ? 'bug' : types[0] ?? null,
    title, url: alert.url, fixAvailable: alert.fixAvailable, advisories: alert.advisories ?? [], description,
  }
}

const KEY_LINE = /^alert-key:[ \t]*([0-9a-f]{12})[ \t]*\r?$/gm

/** Splits candidates into the ones no issue holds by `alert-key:` line and the matched ones. Every issue counts, whatever its status. */
export function matchAlerts(candidates, issues) {
  const keys = new Map()
  for (const issue of issues) {
    for (const [, key] of `${issue.description ?? ''}\n${issue.body ?? ''}`.matchAll(KEY_LINE)) if (!keys.has(key)) keys.set(key, issue)
  }
  const kept = []
  const matched = []
  for (const candidate of candidates) {
    const issue = keys.get(candidate.key)
    if (issue) matched.push({ ...candidate, issue: issue.id, status: issue.status?.name ?? null })
    else kept.push(candidate)
  }
  return { candidates: kept, matched }
}
