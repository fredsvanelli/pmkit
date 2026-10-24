// Reads CHANGELOG.md. See the upgrade design, "Changelog". Each section starts with
// `## <version> - <YYYY-MM-DD>`; `Tracker format: N` and `Setup: <reason>` lines carry data for /pmkit:upgrade.

import { PmkitError } from './errors.mjs'

const HEADING = /^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})\s*$/
const TRACKER_FORMAT = /^Tracker format:\s*(\d+)\s*$/
const SETUP = /^Setup:\s*(.+?)\s*$/

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim())
  if (!match) throw new PmkitError('INVALID_INPUT', `"${version}" is not a version like 1.2.3`, 'Use MAJOR.MINOR.PATCH')
  return match.slice(1).map(Number)
}

/** -1, 0 or 1 for a before, equal to or after b, comparing MAJOR.MINOR.PATCH as numbers. */
export function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  return 0
}

/** The sections in file order: `{ version, date, body, trackerFormat, setup }`. */
export function parseChangelog(text) {
  const sections = []
  let current = null
  for (const line of text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      current = { version: heading[1], date: heading[2], lines: [], trackerFormat: null, setup: [] }
      sections.push(current)
    } else if (/^#{1,2} /.test(line)) {
      current = null
    } else if (current) {
      const format = TRACKER_FORMAT.exec(line)
      const setup = SETUP.exec(line)
      if (format) current.trackerFormat = Number(format[1])
      else if (setup) current.setup.push(setup[1])
      else current.lines.push(line)
    }
  }
  return sections.map(({ lines, ...section }) => ({ version: section.version, date: section.date, body: lines.join('\n').trim(), trackerFormat: section.trackerFormat, setup: section.setup }))
}

/** The sections newer than `version`, oldest first. */
export function sectionsSince(sections, version) {
  return sections.filter((section) => compareVersions(section.version, version) > 0).sort((a, b) => compareVersions(a.version, b.version))
}
