import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareVersions, parseChangelog, sectionsSince } from './lib/changelog.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'scripts', 'pmkit.mjs')

const CRLF = [
  '# Changelog', '',
  '## 0.10.0 - 2026-12-01', '', '- Ten.', '',
  '## 0.9.0 - 2026-11-01', '', '- Nine.', '',
  '## 0.8.1 - 2026-10-01', '', '- Eight.', '',
].join('\r\n')

test('compareVersions orders MAJOR.MINOR.PATCH numerically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1)
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.throws(() => compareVersions('1.2', '1.2.3'), /version/)
})

test('sectionsSince returns the newer sections, oldest first, from a CRLF file', () => {
  const parsed = parseChangelog(CRLF)
  assert.deepEqual(parsed.map((s) => s.version), ['0.10.0', '0.9.0', '0.8.1'])
  assert.deepEqual(sectionsSince(parsed, '0.9.0').map((s) => s.version), ['0.10.0'])
  assert.deepEqual(sectionsSince(parsed, '0.8.1').map((s) => s.version), ['0.9.0', '0.10.0'])
  assert.deepEqual(sectionsSince(parsed, '0.10.0'), [])
})

test('Tracker format and Setup lines are read and left out of the body', () => {
  const text = [
    '# Changelog', '',
    '## 0.2.0 - 2026-11-03', '',
    '- Adds `/pmkit:upgrade`.', '',
    'Tracker format: 2',
    'Setup: first reason.',
    'Setup: second reason.', '',
    '## 0.1.0 - 2026-10-24', '', '- First.', '',
  ].join('\n')
  const [newest, first] = parseChangelog(text)
  assert.equal(newest.trackerFormat, 2)
  assert.deepEqual(newest.setup, ['first reason.', 'second reason.'])
  assert.equal(newest.date, '2026-11-03')
  assert.equal(newest.body, '- Adds `/pmkit:upgrade`.')
  assert.equal(first.trackerFormat, null)
  assert.deepEqual(first.setup, [])
})

test('changelog --file --since --json returns the releases oldest first, with the format change of 0.2.0', () => {
  const result = spawnSync(process.execPath, [CLI, 'changelog', '--file', 'CHANGELOG.md', '--since', '0.0.0', '--json'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const sections = JSON.parse(result.stdout)
  assert.deepEqual(sections.map((section) => [section.version, section.trackerFormat]), [['0.1.0', null], ['0.2.0', 2]])
  assert.equal(sections[1].setup.length, 1)
})
