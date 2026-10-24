import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitUserEmail, requireActor, resolveActor } from './lib/actor.mjs'

const config = {
  members: {
    fred: { name: 'Fred Vanelli', email: 'Fred@Example.com', availability: 1 },
    'agent:claude': { name: 'Claude', availability: 1 },
  },
}

test('resolveActor matches the member by email', () => {
  const actor = resolveActor(config, { email: 'Fred@Example.com', env: {} })
  assert.equal(actor.id, 'fred')
  assert.equal(actor.member.name, 'Fred Vanelli')
})

test('resolveActor ignores case in the email', () => {
  assert.equal(resolveActor(config, { email: 'fred@example.COM', env: {} }).id, 'fred')
})

test('resolveActor falls back to PMKIT_USER when the email matches nobody', () => {
  const actor = resolveActor(config, { email: 'other@example.com', env: { PMKIT_USER: 'agent:claude' } })
  assert.equal(actor.id, 'agent:claude')
})

test('the email wins over PMKIT_USER', () => {
  const actor = resolveActor(config, { email: 'fred@example.com', env: { PMKIT_USER: 'agent:claude' } })
  assert.equal(actor.id, 'fred')
})

test('resolveActor returns null when PMKIT_USER names a non-member', () => {
  assert.equal(resolveActor(config, { email: '', env: { PMKIT_USER: 'ghost' } }), null)
})

test('resolveActor returns null with no email and no PMKIT_USER', () => {
  assert.equal(resolveActor(config, { email: '', env: {} }), null)
})

test('requireActor throws NOT_CONFIGURED with the next step', () => {
  assert.throws(
    () => requireActor(config, { email: '', env: {} }),
    (error) =>
      error.code === 'NOT_CONFIGURED' &&
      error.nextStep === 'Add yourself to members in .issues/config.yaml or set PMKIT_USER',
  )
})

test('requireActor returns the actor when there is one', () => {
  assert.equal(requireActor(config, { email: 'fred@example.com', env: {} }).id, 'fred')
})

test('gitUserEmail returns a string, empty when git fails', () => {
  assert.equal(typeof gitUserEmail(process.cwd()), 'string')
  assert.equal(gitUserEmail('/nonexistent-pmkit-dir'), '')
})
