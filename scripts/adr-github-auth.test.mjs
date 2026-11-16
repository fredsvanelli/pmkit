import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const adrDir = join(root, 'docs', 'adr')
const adrPath = join(adrDir, '0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md')
const adr = () => readFileSync(adrPath, 'utf8')
const context = () => readFileSync(join(root, 'CONTEXT.md'), 'utf8')
const options = () => (adr().split(/^## Considered options$/m)[1] ?? '').split(/^## /m)[0]
const consequences = () => adr().split(/^## Consequences$/m)[1] ?? ''

test('ADR-0007 exists', () => {
  assert.ok(existsSync(adrPath))
})

test('ADR-0007 has a title, Considered options and Consequences', () => {
  const text = adr()
  assert.match(text.split('\n')[0], /^# \S/)
  assert.match(text, /^## Considered options$/m)
  assert.match(text, /^## Consequences$/m)
})

test('ADR-0007 reuses the gh login and holds no token', () => {
  const text = adr()
  for (const name of ['gh api graphql', 'GH_TOKEN', 'GH_ENTERPRISE_TOKEN']) {
    assert.ok(text.includes(name), `ADR must name ${name}`)
  }
  assert.match(text, /holds no token/)
})

test('ADR-0007 asks for the project scope through AUTH', () => {
  const text = adr()
  assert.ok(text.includes('gh auth refresh -s project'))
  assert.ok(text.includes('INSUFFICIENT_SCOPES'))
  assert.match(text, /`AUTH`/)
})

test('ADR-0007 sets GHES 3.19 as the minimum and checks it', () => {
  const text = adr()
  for (const name of ['3.19', 'gh api meta', 'installed_version', 'NOT_SUPPORTED', '2026-12-09']) {
    assert.ok(text.includes(name), `ADR must name ${name}`)
  }
})

test('ADR-0007 reads issue fields, Project fields and the Status field', () => {
  const text = adr()
  assert.match(text, /issue fields?/i)
  assert.match(text, /Project fields?/)
  assert.match(text, /Status field/)
  assert.ok(text.includes('3.21'))
})

test('ADR-0007 names each rejected option', () => {
  const section = options()
  assert.match(section, /fine-grained PAT/i)
  assert.match(section, /GitHub App/)
  assert.ok(section.includes('3.18'))
  assert.ok(section.includes('3.20'))
  assert.match(section, /Project fields only/)
  assert.match(section, /Issue fields only/i)
})

test('ADR-0007 consequences name every dependent issue and setup', () => {
  const section = consequences()
  for (const name of ['PMK-85', 'PMK-86', 'PMK-87', 'PMK-89', '/pmkit:setup']) {
    assert.ok(section.includes(name), `Consequences must name ${name}`)
  }
})

test('no ADR and no line of CONTEXT.md holds a GitHub token', () => {
  const token = /\bgh[pousr]_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]+/
  for (const file of readdirSync(adrDir)) {
    assert.doesNotMatch(readFileSync(join(adrDir, file), 'utf8'), token, file)
  }
  for (const line of context().split('\n')) assert.doesNotMatch(line, token)
})

test('CONTEXT.md defines Issue field against a Project field', () => {
  const match = context().match(/^\*\*Issue field\*\*:\n(.+)$/m)
  assert.ok(match, 'Issue field term is missing')
  assert.match(match[1], /Project field/)
})
