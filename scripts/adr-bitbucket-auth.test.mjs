import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const adrPath = join(root, 'docs', 'adr', '0018-bitbucket-cloud-only-with-a-scoped-token-from-the-environment.md')
const adr = () => readFileSync(adrPath, 'utf8')
const context = () => readFileSync(join(root, 'CONTEXT.md'), 'utf8')
const includesAll = (text, names, where) => {
  for (const name of names) assert.ok(text.includes(name), `${where} must name ${name}`)
}

test('ADR-0018 exists', () => {
  assert.ok(existsSync(adrPath))
})

test('ADR-0018 has a title, an Accepted status, Considered options and Consequences', () => {
  const text = adr()
  assert.match(text.split('\n')[0], /^# \S/)
  assert.match(text, /^## Status\n+Accepted$/m)
  assert.match(text, /^## Considered options$/m)
  assert.match(text, /^## Consequences$/m)
})

test('ADR-0018 reads BITBUCKET_TOKEN from the environment as Bearer and stores no credential', () => {
  const text = adr()
  includesAll(text, ['BITBUCKET_TOKEN', 'Bearer', 'scripts/lib/bitbucket/credential.mjs'], 'ADR')
  assert.match(text, /stores no credential/)
})

test('ADR-0018 pins Bitbucket Cloud and refuses Data Center', () => {
  includesAll(adr(), ['api.bitbucket.org', '2029-03-28'], 'ADR')
})

test('ADR-0018 names the four token scopes', () => {
  includesAll(adr(), ['read:repository:bitbucket', 'read:pullrequest:bitbucket', 'write:pullrequest:bitbucket', 'read:pipeline:bitbucket'], 'ADR')
})

test('CONTEXT.md Git host names bitbucket and BITBUCKET_TOKEN', () => {
  const term = context().match(/^\*\*Git host\*\*:\n(.+)$/m)
  assert.ok(term, 'Git host term is missing')
  assert.match(term[1], /`bitbucket`/)
  assert.match(term[1], /BITBUCKET_TOKEN/)
})
