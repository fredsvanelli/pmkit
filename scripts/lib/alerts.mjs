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
      title: advisory?.title ?? `vulnerable through ${names.join(', ')}`,
      severity,
      url: advisory?.url ?? null,
      fixAvailable: Boolean(entry.fixAvailable),
    }
  })
  return { alerts, warnings }
}

/** The scanners, in the order they run. `detect` says whether the repository has the scanner. */
export const SCANNERS = [
  {
    id: 'npm-audit',
    needs: 'package-lock.json',
    detect: (root) => fs.existsSync(path.join(root, 'package-lock.json')),
    // npm exits 1 when it finds vulnerabilities, so the output counts whatever the exit code is.
    run: (root, env) => {
      const result = spawnSync('npm', ['audit', '--json'], { cwd: root, env, encoding: 'utf8' })
      if (result.error) {
        throw new Error(result.error.code === 'ENOENT' ? 'npm is not installed or not on PATH' : result.error.message)
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
export function collectAlerts(root, { env = process.env } = {}) {
  const scanners = []
  const alerts = []
  const warnings = []
  for (const scanner of SCANNERS) {
    if (!scanner.detect(root)) {
      scanners.push({ id: scanner.id, detected: false, alerts: 0 })
      continue
    }
    try {
      const found = scanner.run(root, env)
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
