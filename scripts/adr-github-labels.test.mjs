// Checks ADR 0009 (GitHub Issues without a Project reads statuses and types from labels) and its glossary term.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const adrPath = join(root, 'docs', 'adr', '0009-github-issues-without-a-project-reads-statuses-and-types-from-labels.md')
const adr = () => readFileSync(adrPath, 'utf8')

test('ADR-0009 exists with a title, Status, Considered options and Consequences', () => {
  assert.ok(existsSync(adrPath))
  const text = adr()
  assert.match(text.split('\n')[0], /^# \S/)
  for (const heading of ['## Status', '## Considered options', '## Consequences']) assert.match(text, new RegExp(`^${heading}$`, 'm'))
})

test('ADR-0009 names the config value, the mutations and the broken mapping', () => {
  const text = adr()
  for (const name of ['label:<name>', 'addLabelsToLabelable', 'removeLabelsFromLabelable', 'NOT_CONFIGURED', 'mappings.status', 'mappings.types', 'NOT_SUPPORTED']) {
    assert.ok(text.includes(name), `ADR must name ${name}`)
  }
})

test('CONTEXT.md defines Status label', () => {
  assert.match(readFileSync(join(root, 'CONTEXT.md'), 'utf8'), /^\*\*Status label\*\*:$/m)
})
