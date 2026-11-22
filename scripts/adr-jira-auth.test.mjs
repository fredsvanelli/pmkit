import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const adrDir = join(root, 'docs', 'adr')
const adrPath = join(adrDir, '0013-jira-cloud-only-with-an-api-token-from-the-environment.md')
const adr = () => readFileSync(adrPath, 'utf8')
const context = () => readFileSync(join(root, 'CONTEXT.md'), 'utf8')
const options = () => (adr().split(/^## Considered options$/m)[1] ?? '').split(/^## /m)[0]
const consequences = () => adr().split(/^## Consequences$/m)[1] ?? ''
const includesAll = (text, names, where) => {
  for (const name of names) assert.ok(text.includes(name), `${where} must name ${name}`)
}

test('ADR-0013 exists', () => {
  assert.ok(existsSync(adrPath))
})

test('ADR-0013 has a title, Considered options and Consequences', () => {
  const text = adr()
  assert.match(text.split('\n')[0], /^# \S/)
  assert.match(text, /^## Considered options$/m)
  assert.match(text, /^## Consequences$/m)
})

test('ADR-0013 chooses Jira Cloud only and refuses Data Center', () => {
  includesAll(adr(), ['Cloud', 'serverInfo', 'deploymentType', 'NOT_SUPPORTED', '2029-03-28'], 'ADR')
})

test('ADR-0013 reads the token from the environment as Basic auth and stores no credential', () => {
  const text = adr()
  includesAll(text, ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'Basic', 'scripts/lib/jira/credential.mjs'], 'ADR')
  assert.match(text, /stores no credential/)
})

test('ADR-0013 pins the site and one space', () => {
  includesAll(adr(), ['tracker.scope.site', 'tracker.scope.space', 'company-managed', 'team-managed'], 'ADR')
})

test('ADR-0013 says tokens expire and leaves scoped tokens to a live check', () => {
  includesAll(adr(), ['365', 'api.atlassian.com/ex/jira', 'PMK-75'], 'ADR')
})

test('ADR-0013 names each rejected option', () => {
  const section = options()
  assert.match(section, /Data Center/)
  assert.match(section, /3LO/)
  assert.match(section, /acli/)
  assert.match(section, /keychain/i)
  assert.match(section, /several spaces/i)
})

test('ADR-0013 consequences name every dependent issue and setup', () => {
  includesAll(consequences(), ['PMK-75', 'PMK-76', '/pmkit:setup'], 'Consequences')
})

test('ADR-0013 does not claim a follow-up issue exists', () => {
  assert.doesNotMatch(adr(), /follow-up issue/i)
})

test('no ADR and no line of CONTEXT.md holds an Atlassian token', () => {
  const token = /ATATT3[A-Za-z0-9_=-]{20,}/
  for (const file of readdirSync(adrDir)) {
    assert.doesNotMatch(readFileSync(join(adrDir, file), 'utf8'), token, file)
  }
  for (const line of context().split('\n')) assert.doesNotMatch(line, token)
})

test('CONTEXT.md defines Site and Space with their config keys', () => {
  const site = context().match(/^\*\*Site\*\*:\n(.+)$/m)
  const space = context().match(/^\*\*Space\*\*:\n(.+)$/m)
  assert.ok(site, 'Site term is missing')
  assert.ok(space, 'Space term is missing')
  assert.match(site[1], /tracker\.scope\.site/)
  assert.match(space[1], /tracker\.scope\.space/)
})
