import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const adrDir = join(root, 'docs', 'adr')
const adrPath = join(adrDir, '0005-linear-uses-a-personal-api-key-from-the-environment.md')
const adr = () => readFileSync(adrPath, 'utf8')
const context = () => readFileSync(join(root, 'CONTEXT.md'), 'utf8')
const consequences = () => adr().split(/^## Consequences$/m)[1] ?? ''

test('ADR-0005 exists', () => {
  assert.ok(existsSync(adrPath))
})

test('ADR-0005 has a title, Considered options and Consequences', () => {
  const text = adr()
  assert.match(text.split('\n')[0], /^# \S/)
  assert.match(text, /^## Considered options$/m)
  assert.match(text, /^## Consequences$/m)
})

test('ADR-0005 names the variable and the header without Bearer', () => {
  const text = adr()
  assert.match(text, /LINEAR_API_KEY/)
  assert.match(text, /Authorization/)
  assert.match(text, /no `Bearer` prefix/)
})

test('ADR-0005 names each considered option', () => {
  const text = adr()
  assert.match(text, /OAuth/)
  assert.match(text, /MCP/)
  assert.match(text, /keychain/)
  assert.match(text, /key file/i)
})

test('ADR-0005 consequences name every dependent issue and the workspace pin', () => {
  const section = consequences()
  for (const name of ['PMK-30', 'PMK-31', 'PMK-32', 'PMK-33', 'PMK-39', '/pmkit:setup']) {
    assert.ok(section.includes(name), `Consequences must name ${name}`)
  }
  assert.match(adr(), /tracker\.scope\.workspace/)
})

test('ADR-0005 says pmkit stores no credential and keeps OAuth for a later Linear agent', () => {
  const text = adr()
  assert.match(text, /stores no credential/)
  assert.match(text, /actor=app/)
})

test('no ADR and no line of CONTEXT.md holds a Linear key', () => {
  const key = /lin_api_[A-Za-z0-9]/
  for (const file of readdirSync(adrDir)) {
    assert.doesNotMatch(readFileSync(join(adrDir, file), 'utf8'), key, file)
  }
  for (const line of context().split('\n')) assert.doesNotMatch(line, key)
})

test('CONTEXT.md defines Workspace with its config key', () => {
  const match = context().match(/^\*\*Workspace\*\*:\n(.+)$/m)
  assert.ok(match, 'Workspace term is missing')
  assert.match(match[1], /tracker\.scope\.workspace/)
})
