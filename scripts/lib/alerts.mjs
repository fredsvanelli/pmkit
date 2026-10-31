// Security alerts from the scanners the repository already has. See
// docs/superpowers/specs/2026-10-30-pmk-48-local-security-alerts-design.md.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** The severity of an alert, highest first. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low']

const NPM_SEVERITY = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'low' }

/** Parses the stdout of `npm audit --json` (report version 2). Throws an Error when it is not an audit report. */
export function parseNpmAudit(stdout) {
  if (!stdout || stdout.trim() === '') throw new Error('npm audit printed empty output')
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
    const advisory = objects[0]
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

/** The most output one scanner may print, in bytes. The same limit as the GitHub host. */
export const NPM_MAX_BUFFER = 256 * 1024 * 1024
/** The longest one scanner may run, in milliseconds. */
export const NPM_TIMEOUT_MS = 60000

/** The npm executable name: Windows needs the .cmd shim, which spawnSync does not resolve on its own. */
export const npmCommand = (platform = process.platform) => (platform === 'win32' ? 'npm.cmd' : 'npm')

/**
 * True when the shell could not find npm.cmd. cmd.exe exits with 9009 for an unknown command in every display language,
 * so the exit code is the main test. The English "is not recognized" text on stderr is the fallback.
 */
export const isNpmMissingOnShell = (result) => result.status === 9009
  || (result.status !== 0 && /is not recognized/i.test(result.stderr ?? ''))

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json']

/** The scanners, in the order they run. `detect` says whether the repository has the scanner. */
export const SCANNERS = [
  {
    id: 'npm-audit',
    needs: LOCKFILES.join(' or '),
    detect: (root) => LOCKFILES.some((file) => fs.existsSync(path.join(root, file))),
    // npm exits 1 when it finds vulnerabilities, so the output counts whatever the exit code is.
    run: (root, env, { timeoutMs, platform, spawn }) => {
      // On Windows, Node refuses to spawn npm.cmd without a shell (EINVAL), so the call goes through cmd.exe.
      const result = spawn(npmCommand(platform), ['audit', '--json'], { cwd: root, env, encoding: 'utf8', maxBuffer: NPM_MAX_BUFFER, timeout: timeoutMs, shell: platform === 'win32' })
      if (result.error) {
        if (result.error.code === 'ENOENT') throw new Error('npm is not installed or not on PATH')
        if (result.error.code === 'ETIMEDOUT') throw new Error(`npm audit timed out after ${timeoutMs / 1000} s`)
        if (result.error.code === 'ENOBUFS') throw new Error(`npm audit printed more than ${NPM_MAX_BUFFER / 1024 / 1024} MiB`)
        throw new Error(result.error.message)
      }
      // With the shell, a missing npm.cmd exits non-zero and does not raise ENOENT.
      if (platform === 'win32' && isNpmMissingOnShell(result)) throw new Error('npm is not installed or not on PATH')
      return parseNpmAudit(result.stdout)
    },
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
      const found = scanner.run(root, env, { timeoutMs, platform, spawn })
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
 * second, medium the third and low the last, clamped to the list. `none` is never used. An empty list gives null.
 */
export function priorityFor(severity, priorities) {
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
  const title = `Security: ${alert.package}: ${alert.title}`.slice(0, MAX_TITLE)
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
