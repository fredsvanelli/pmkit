// The CLI over the Linear adapter with a fake fetch. No test here touches the network or the real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { isMutation, operationName } from './lib/linear/client.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, acmeTeam, fakeLinearFetch, fakeTriage, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

// gitUserEmail reads the process environment, so the in-process runs need the same git isolation as childEnv.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function setup({ edit, withKey = true } = {}) {
  const root = useLinear(makeRepo('basic'))
  if (edit) {
    const file = path.join(root, '.pmkit', 'config.yaml')
    fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')))
  }
  const env = { ...childEnv(), ...userStoreEnv().env, ...(withKey ? { LINEAR_API_KEY: FAKE_KEY } : {}) }
  return { root, env }
}

function cli(context, args, fetch = fakeLinearFetch(fakeWorkspace())) {
  return run(args, { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
}

const callsOf = (fetch, name) => fetch.calls.filter((call) => operationName(call.body.query) === name).length
const errorOf = (result) => JSON.parse(result.stdout).error

test('discover --json returns auth before teams and statuses', async () => {
  const result = await cli(setup(), ['discover', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(data).slice(0, 5), ['auth', 'workspace', 'team', 'teams', 'statuses'])
  assert.equal(data.statuses.find((status) => status.name === 'Duplicate').category, 'canceled')
  assert.equal(result.stderr, '')
})

test('discover always refreshes', async () => {
  const context = setup()
  const fetch = fakeLinearFetch(fakeWorkspace())
  assert.equal((await cli(context, ['discover', '--json'], fetch)).code, 0)
  assert.equal((await cli(context, ['discover', '--json'], fetch)).code, 0)
  assert.equal(callsOf(fetch, 'PmkitTeams'), 2)
  const before = fetch.calls.length
  const capabilities = await cli(context, ['capabilities', '--json'], fetch)
  assert.equal(capabilities.code, 0, capabilities.stderr)
  assert.equal(fetch.calls.length, before)
})

test('discover prints the workspace and teams lines', async () => {
  const result = await cli(setup(), ['discover'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: Acme \(acme\), plan free, viewer Test User$/m)
  assert.match(result.stdout, /^teams:$/m)
  assert.match(result.stdout, /^ {2}ACME {2}Acme {2}cycles off, triage off, estimate notUsed$/m)
  assert.ok(result.stdout.indexOf('workspace:') < result.stdout.indexOf('statuses:'))
})

test('a cached discover result prints the workspace line without a viewer', async () => {
  const context = setup()
  const fetch = fakeLinearFetch(fakeWorkspace())
  await cli(context, ['discover', '--json'], fetch)
  const result = await cli(context, ['capabilities'], fetch)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^workspace: acme \(free\)$/m)
  assert.match(result.stdout, /^team: \(none\)$/m)
  assert.match(result.stdout, /^discovered: 2026-/m)
  assert.ok(result.stdout.indexOf('git host:') < result.stdout.indexOf('workspace:'))
})

test('discover without a key exits 2 with AUTH', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const result = await cli(setup({ withKey: false }), ['discover', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('a refused read prints no key', async () => {
  for (const args of [['discover', '--json'], ['discover']]) {
    const result = await cli(setup(), args, fakeLinearFetch(fakeWorkspace({ refuse: ['PmkitTeams'] })))
    assert.equal(result.code, 2, args.join(' '))
    if (args.includes('--json')) assert.equal(errorOf(result).code, 'AUTH')
    else assert.match(result.stderr, /^error: Linear refused the request for this key$/m)
    assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY), args.join(' '))
  }
})

test('capabilities --json reports 20 entries', async () => {
  const result = await cli(setup(), ['capabilities', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const manifest = JSON.parse(result.stdout)
  assert.equal(manifest.capabilities.length, 20)
  assert.equal(manifest.workspace.plan, 'free')
  assert.equal(manifest.tracker, 'linear')
})

test('validate lists a missing workspace and no secret-like key', async () => {
  const context = setup({ edit: (text) => text.replace('    workspace: acme', '    token: plainvalue') })
  const result = await cli(context, ['validate'])
  assert.match(result.stdout, /tracker\.scope\.workspace is required for linear/)
  assert.ok(!result.stdout.includes('token'), result.stdout)
})

test('discover with a secret-like key exits 2 with INVALID_INPUT', async () => {
  const context = setup({ edit: (text) => text.replace('    workspace: acme', '    workspace: acme\n    token: plainvalue') })
  const result = await cli(context, ['discover', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.ok(error.message.includes('tracker.scope.token'))
  assert.ok(!error.message.includes('plainvalue'))
})

test('the workspace rename warning reaches stderr', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-new' }), { workspace: 'acme-new', previousUrlKeys: ['acme'] })
  const result = await cli(setup(), ['discover', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /^warning: Linear renamed workspace acme to acme-new/m)
})

test('issues list exits 2 with NOT_SUPPORTED', async () => {
  const fetch = fakeLinearFetch(fakeWorkspace())
  const result = await cli(setup(), ['issues', 'list', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'NOT_SUPPORTED',
    message: 'the Linear adapter does not implement searchIssues yet',
    nextStep: 'Set tracker.system to local in .pmkit/config.yaml to use this command now',
  })
  assert.equal(fetch.calls.length, 0)
})

// Triage rotation (PMK-43). The Free workspace is the proof for the absent capability; the paid ones use the fake.
const BUSINESS = { type: 'Business' }
const paidTeam = (extra = {}) => ({ ...acmeTeam, triageEnabled: true, ...extra })
const MANUAL = {
  id: 'tr-1',
  action: 'assign',
  manualSelection: { userIds: ['user-2', 'user-1'], assignmentIndex: 0 },
  timeSchedule: null,
  currentUser: { id: 'user-2', name: 'Ada Lovelace' },
}
const SCHEDULED = {
  id: 'tr-2',
  action: 'notify',
  manualSelection: null,
  timeSchedule: { id: 'ts-1', name: 'On call', externalUrl: 'https://example.com/s', integration: { service: 'pagerDuty' } },
  currentUser: { id: 'user-1', name: 'Test User' },
}
const triageFetch = ({ workspace = {}, triage = {} } = {}) => fakeLinearFetch({ ...fakeWorkspace(workspace), ...fakeTriage(triage) })
const businessFetch = (triage = {}, workspace = {}) => triageFetch({ workspace: { subscription: BUSINESS, teams: [paidTeam()], ...workspace }, triage })
const TRIAGE_OPERATIONS = ['PmkitTriageShow', 'PmkitTriageSuggestions', 'PmkitTriageCreate', 'PmkitTriageUpdate', 'PmkitTriageDelete']
const triageCalls = (fetch) => fetch.calls.filter((call) => TRIAGE_OPERATIONS.includes(operationName(call.body.query)))
const mutationCalls = (fetch) => fetch.calls.filter((call) => isMutation(call.body.query))

test('linear triage show on a Free workspace says it is unavailable and sends no triage query', async () => {
  const fetch = triageFetch()
  const json = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch)
  assert.equal(json.code, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), {
    available: false,
    reason: 'plan',
    plan: 'free',
    team: 'ACME',
    enableHint: 'Triage responsibility needs the Business or Enterprise plan',
  })
  const text = await cli(setup(), ['linear', 'triage', 'show'], fetch)
  assert.equal(text.code, 0, text.stderr)
  assert.equal(text.stdout, 'triage rotation: unavailable\nreason: plan\nplan: free\nenable: Triage responsibility needs the Business or Enterprise plan\n')
  assert.equal(triageCalls(fetch).length, 0)
  assert.equal(mutationCalls(fetch).length, 0)
})

test('linear triage show with triage off reports triage_off and sends no triage query', async () => {
  const fetch = triageFetch({ workspace: { subscription: BUSINESS } })
  const result = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.reason, 'triage_off')
  assert.equal(data.enableHint, "Turn on triage in the team's settings in Linear")
  assert.equal(triageCalls(fetch).length, 0)
})

test('linear triage show prints a manual rotation, a schedule and no responsibility', async () => {
  const manual = await cli(setup(), ['linear', 'triage', 'show'], businessFetch({ responsibility: MANUAL }))
  assert.equal(manual.code, 0, manual.stderr)
  assert.equal(manual.stdout, 'team: ACME\naction: assign\nsource: manual\non duty: Ada Lovelace\nrotation: Ada Lovelace (current), Test User\n')
  const json = JSON.parse((await cli(setup(), ['linear', 'triage', 'show', '--json'], businessFetch({ responsibility: MANUAL }))).stdout)
  assert.equal(json.available, true)
  assert.equal(json.team, 'ACME')
  assert.deepEqual(json.duty.members.map((member) => member.id), ['user-2', 'user-1'])
  const scheduled = await cli(setup(), ['linear', 'triage', 'show'], businessFetch({ responsibility: SCHEDULED }))
  assert.equal(scheduled.stdout, 'team: ACME\naction: notify\nsource: schedule\non duty: Test User\nschedule: On call (pagerduty)\n')
  const none = await cli(setup(), ['linear', 'triage', 'show'], businessFetch({ responsibility: null }))
  assert.equal(none.stdout, 'team: ACME\nnobody is on triage duty\n')
})

test('linear triage show picks the team from --team, then the scope, then the only team', async () => {
  const second = paidTeam({ id: 'team-two', key: 'TWO', name: 'Two' })
  const fetch = () => businessFetch({ responsibility: null }, { teams: [paidTeam(), second] })
  const teamOf = async (context, args) => JSON.parse((await cli(context, ['linear', 'triage', 'show', '--json', ...args], fetch())).stdout).team
  assert.equal(await teamOf(setup(), ['--team', 'TWO']), 'TWO')
  const scoped = setup({ edit: (text) => text.replace('    workspace: acme', '    workspace: acme\n    team: TWO') })
  assert.equal(await teamOf(scoped, []), 'TWO')
  assert.equal(await teamOf(scoped, ['--team', 'ACME']), 'ACME')
  const many = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch())
  assert.equal(many.code, 2)
  assert.equal(errorOf(many).code, 'INVALID_INPUT')
  assert.match(errorOf(many).nextStep, /ACME, TWO/)
  const unknown = await cli(setup(), ['linear', 'triage', 'show', '--json', '--team', 'NOPE'], fetch())
  assert.equal(errorOf(unknown).code, 'INVALID_INPUT')
})

test('linear triage show on a Local repository exits 2 with NOT_SUPPORTED', async () => {
  const root = makeRepo('basic')
  const result = await run(['linear', 'triage', 'show', '--json'], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env } })
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result).code, 'NOT_SUPPORTED')
  assert.equal(errorOf(result).message, '`linear triage show` works only with the Linear tracker, and tracker.system is "local"')
})

test('linear triage show without a key exits 2 with AUTH and sends nothing', async () => {
  const fetch = businessFetch()
  const result = await cli(setup({ withKey: false }), ['linear', 'triage', 'show', '--json'], fetch)
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(fetch.calls.length, 0)
})

test('linear triage show prints no key', async () => {
  const fetch = businessFetch({ responsibility: MANUAL })
  const result = await cli(setup(), ['linear', 'triage', 'show', '--json'], fetch)
  assert.ok(!result.stdout.includes(FAKE_KEY) && !result.stderr.includes(FAKE_KEY))
})

const sug = (type, extra = {}) => ({ type, state: 'active', metadata: { score: 0.9, reasons: ['why'] }, presentedReasons: null, ...extra })
const inboxIssue = (identifier, createdAt, suggestions = []) => ({ identifier, title: `Title ${identifier}`, createdAt, suggestions: { nodes: suggestions } })
const label = { suggestedLabel: { id: 'l1', name: 'Bug' } }

test('linear triage suggestions on a Free workspace is unavailable and sends no query', async () => {
  const fetch = triageFetch()
  const result = await cli(setup(), ['linear', 'triage', 'suggestions', '--json'], fetch)
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.available, false)
  assert.equal(data.reason, 'plan')
  assert.equal(triageCalls(fetch).length, 0)
})

test('linear triage suggestions lists active suggestions, oldest issue first, and drops stale ones', async () => {
  const issues = [
    inboxIssue('ACME-2', '2026-10-02T00:00:00Z', [sug('label', label), sug('label', { ...label, state: 'stale' })]),
    inboxIssue('ACME-1', '2026-10-01T00:00:00Z', [sug('assignee', { suggestedUser: { id: 'user-2', name: 'Ada Lovelace' }, metadata: { score: 0.5, reasons: [] } })]),
    inboxIssue('ACME-3', '2026-10-03T00:00:00Z', []),
  ]
  const json = JSON.parse((await cli(setup(), ['linear', 'triage', 'suggestions', '--json'], businessFetch({ issues }))).stdout)
  assert.equal(json.available, true)
  assert.deepEqual(json.issues.map((issue) => issue.id), ['ACME-1', 'ACME-2'])
  assert.equal(json.issues[1].suggestions.length, 1)
  assert.deepEqual(json.issues[1].suggestions[0], { type: 'label', target: { id: 'l1', name: 'Bug' }, score: 0.9, reasons: ['why'] })
  assert.equal(json.withoutSuggestions, 1)
  const text = await cli(setup(), ['linear', 'triage', 'suggestions'], businessFetch({ issues }))
  assert.match(text.stdout, /^ACME-1 {2}Title ACME-1\n {2}assignee Ada Lovelace \(score 0\.5\)\nACME-2 /)
})

test('linear triage suggestions on an empty inbox says so', async () => {
  const result = await cli(setup(), ['linear', 'triage', 'suggestions'], businessFetch({ issues: [] }))
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, 'no issue is waiting in triage\n')
})

test('linear triage suggestions defaults --limit to 25, clamps it to 100 and warns when issues are left out', async () => {
  const issues = Array.from({ length: 30 }, (_, index) => inboxIssue(`ACME-${index + 1}`, `2026-10-01T00:${String(index).padStart(2, '0')}:00Z`, [sug('label', label)]))
  const firstOf = (fetch) => triageCalls(fetch)[0].body.variables.first
  const fetch = businessFetch({ issues })
  const base = await cli(setup(), ['linear', 'triage', 'suggestions', '--json'], fetch)
  assert.equal(firstOf(fetch), 25)
  assert.equal(JSON.parse(base.stdout).issues.length, 25)
  assert.match(base.stderr, /^warning: more issues are waiting in triage than --limit 25 shows/m)
  const huge = businessFetch({ issues })
  const clamped = await cli(setup(), ['linear', 'triage', 'suggestions', '--json', '--limit', '500'], huge)
  assert.equal(firstOf(huge), 100)
  assert.equal(JSON.parse(clamped.stdout).issues.length, 30)
  assert.match(clamped.stderr, /^warning: --limit 500 is above 100; using 100$/m)
  const bad = await cli(setup(), ['linear', 'triage', 'suggestions', '--json', '--limit', '0'], businessFetch({ issues }))
  assert.equal(errorOf(bad).code, 'INVALID_INPUT')
})
