// Security alerts from the scanners the repository already has. See
// docs/superpowers/specs/2026-10-30-pmk-48-local-security-alerts-design.md.
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
    const advisory = via.find((item) => item !== null && typeof item === 'object')
    const names = via.filter((item) => typeof item === 'string')
    return {
      id: `npm-audit:${name}`,
      scanner: 'npm-audit',
      package: name,
      title: advisory?.title ?? (names.length > 0 ? `vulnerable through ${names.join(', ')}` : 'no advisory details from npm audit'),
      severity,
      url: advisory?.url ?? null,
      fixAvailable: Boolean(entry.fixAvailable),
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

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json']

/** The scanners, in the order they run. `detect` says whether the repository has the scanner. */
export const SCANNERS = [
  {
    id: 'npm-audit',
    needs: LOCKFILES.join(' or '),
    detect: (root) => LOCKFILES.some((file) => fs.existsSync(path.join(root, file))),
    // npm exits 1 when it finds vulnerabilities, so the output counts whatever the exit code is.
    run: (root, env, { timeoutMs }) => {
      const result = spawnSync(npmCommand(), ['audit', '--json'], { cwd: root, env, encoding: 'utf8', maxBuffer: NPM_MAX_BUFFER, timeout: timeoutMs })
      if (result.error) {
        if (result.error.code === 'ENOENT') throw new Error('npm is not installed or not on PATH')
        if (result.error.code === 'ETIMEDOUT') throw new Error(`npm audit timed out after ${timeoutMs / 1000} s`)
        if (result.error.code === 'ENOBUFS') throw new Error(`npm audit printed more than ${NPM_MAX_BUFFER / 1024 / 1024} MiB`)
        throw new Error(result.error.message)
      }
      return parseNpmAudit(result.stdout)
    },
  },
]

const rank = (alert) => SEVERITIES.indexOf(alert.severity)

/**
 * Runs every scanner the repository at `root` has. A scanner that fails is reported in `scanners` and `warnings`,
 * never thrown. Alerts sort by severity, then package.
 */
export function collectAlerts(root, { env = process.env, timeoutMs = NPM_TIMEOUT_MS } = {}) {
  const scanners = []
  const alerts = []
  const warnings = []
  for (const scanner of SCANNERS) {
    if (!scanner.detect(root)) {
      scanners.push({ id: scanner.id, detected: false, alerts: 0 })
      continue
    }
    try {
      const found = scanner.run(root, env, { timeoutMs })
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
