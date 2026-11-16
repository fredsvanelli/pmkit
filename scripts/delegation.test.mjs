import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_ID, delegationComment, localRunLine, nativeRunLine, parseDelegation } from './lib/delegation.mjs'

const sample = (instructions = 'Add the export.\n') => delegationComment({ issue: 'ISS-1', agent: 'agent:claude', by: 'fred', instructions })

test('delegationComment starts with the record line and holds the instructions and the local steps', () => {
  const body = sample()
  assert.equal(body.split('\n')[0], 'Delegated to agent:claude by fred, to run locally.')
  assert.match(body, /^## Instructions\n\nAdd the export\.\n\n## Run it locally$/m)
  assert.ok(body.includes('`/pmkit:issues:work ISS-1 --as agent:claude`'))
})

test('blank instructions fall back to the default line', () => {
  for (const instructions of ['  \n', '', undefined]) {
    const body = delegationComment({ issue: 'ISS-1', agent: 'agent:claude', by: 'fred', instructions })
    assert.match(body, /## Instructions\n\nWork on ISS-1 as its description and acceptance criteria say\.\n/)
  }
})

test('parseDelegation reads the first line', () => {
  assert.deepEqual(parseDelegation(sample()), { agent: 'agent:claude', by: 'fred', run: 'local' })
  assert.deepEqual(parseDelegation('Delegated to agent:bot-2 by agent:claude, to run locally.'), { agent: 'agent:bot-2', by: 'agent:claude', run: 'local' })
  assert.equal(parseDelegation('Looks good.'), null)
  assert.equal(parseDelegation('Note: Delegated to agent:claude by fred, to run locally.'), null)
  assert.equal(parseDelegation(undefined), null)
})

test('AGENT_ID accepts agent members only', () => {
  assert.ok(AGENT_ID.test('agent:claude'))
  assert.ok(AGENT_ID.test('agent:github-bot'))
  for (const id of ['fred', 'agent:', 'agent:Claude', 'xagent:claude', 'agent:claude ']) assert.equal(AGENT_ID.test(id), false, id)
})

test('localRunLine names the work command and the --as flag', () => {
  assert.equal(localRunLine('ISS-1', 'agent:claude'), 'the agent runs locally: /pmkit:issues:work ISS-1 --as agent:claude')
})

test('a native delegation comment has the instructions and no local steps', () => {
  const body = delegationComment({ issue: 'ACME-1', agent: 'agent:user-4', by: 'user-1', instructions: 'Do it.', run: 'native' })
  assert.equal(body.split('\n')[0], 'Delegated to agent:user-4 by user-1, to run in the tracker.')
  assert.match(body, /## Instructions\n\nDo it\.\n/)
  assert.ok(!body.includes('Run it locally'))
  assert.deepEqual(parseDelegation(body), { agent: 'agent:user-4', by: 'user-1', run: 'native' })
})

test('nativeRunLine says the tracker runs the agent', () => {
  assert.equal(nativeRunLine('ACME-1', 'agent:user-4'), 'the tracker runs the agent: agent:user-4 works on ACME-1 there')
})

test('parseDelegation tolerates trailing spaces and CRLF on the first line', () => {
  const line = 'Delegated to agent:claude by fred, to run locally.'
  const record = { agent: 'agent:claude', by: 'fred', run: 'local' }
  assert.deepEqual(parseDelegation(`${line}  \r\n\r\n## Instructions\r\n`), record)
  assert.deepEqual(parseDelegation(`${line} `), record)
  assert.equal(parseDelegation(` ${line}`), null)
})

test('the delegation comment says commits and the pull request keep the user identity', () => {
  assert.match(sample(), /tracker events .* as the agent's.*commits and the pull request keep your own identity/is)
})
