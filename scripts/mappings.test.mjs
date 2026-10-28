import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NONE, brokenMappings, parseMappingFlags, proposeMappings } from './lib/mappings.mjs'

// A hand-written description. Nothing here names a tracker.
function describe({ viewerTeams = ['AA'], teams, types = ['feature', 'bug'] } = {}) {
  const team = (key, extra = {}) => ({
    key,
    name: key,
    candidates: {
      'mappings.status.in_review': ['Review', 'Doing'],
      'mappings.status.blocked': ['Todo', 'Doing'],
      'mappings.fields.estimate': [],
      'mappings.types.feature': ['Feature', 'Bug', 'Docs'],
      'mappings.types.bug': ['Bug', 'Feature', 'Docs'],
    },
    recommended: { 'mappings.status.in_review': 'Review', 'mappings.status.blocked': NONE, 'mappings.types.feature': 'Feature', 'mappings.types.bug': 'Bug' },
    notes: { 'mappings.fields.estimate': 'team has estimates off' },
    exists: () => true,
    ...extra,
  })
  return { workspace: { urlKey: 'acme', name: 'Acme', plan: 'free' }, viewerTeams, types, teams: teams ?? [team('AA')], team }
}
const paths = (result) => result.questions.map((question) => question.path)

test('one viewer team is applied with its reason', () => {
  const result = proposeMappings(describe(), {}, {})
  assert.equal(result.team, 'AA')
  assert.deepEqual(result.applied, [
    { path: 'tracker.scope.workspace', value: 'acme', reason: 'the key belongs to this workspace' },
    { path: 'tracker.scope.team', value: 'AA', reason: 'you are a member of one team' },
  ])
})

test('two viewer teams give one question with only those teams and no other question', () => {
  const d = describe({ viewerTeams: ['AA', 'BB'] })
  d.teams = [d.team('AA'), d.team('BB'), d.team('CC')]
  const result = proposeMappings(d, {}, {})
  assert.equal(result.team, null)
  assert.deepEqual(paths(result), ['tracker.scope.team'])
  assert.deepEqual(result.questions[0].candidates, ['AA', 'BB'])
})

test('no viewer team offers every team', () => {
  const d = describe({ viewerTeams: [] })
  d.teams = [d.team('AA'), d.team('BB')]
  assert.deepEqual(proposeMappings(d, {}, {}).questions[0].candidates, ['AA', 'BB'])
})

test('a team answer may be any team of the workspace and a stranger fails', () => {
  const d = describe({ viewerTeams: ['AA', 'BB'] })
  d.teams = [d.team('AA'), d.team('BB'), d.team('CC')]
  assert.equal(proposeMappings(d, {}, { team: 'CC' }).team, 'CC')
  assert.throws(() => proposeMappings(d, {}, { team: 'ZZ' }), (error) => error.code === 'INVALID_INPUT' && /AA, BB, CC/.test(error.nextStep))
})

test('in review and blocked are always asked, with one candidate and with none', () => {
  const d = describe()
  d.teams[0].candidates['mappings.status.in_review'] = ['Only']
  d.teams[0].candidates['mappings.status.blocked'] = []
  const result = proposeMappings(d, {}, {})
  const [inReview, blocked] = result.questions
  assert.deepEqual([inReview.path, inReview.candidates, inReview.flag], ['mappings.status.in_review', ['Only'], '--status in_review=<value>'])
  assert.deepEqual([blocked.path, blocked.candidates, blocked.recommended], ['mappings.status.blocked', [], NONE])
  assert.equal(inReview.none, 'No status means in review')
})

test('one estimate candidate is applied, two are asked, none gives a note and no question', () => {
  const one = describe()
  one.teams[0].candidates['mappings.fields.estimate'] = ['native']
  const applied = proposeMappings(one, {}, {})
  assert.deepEqual(applied.applied.at(-1), { path: 'mappings.fields.estimate', value: 'native', reason: 'the tracker offers only this field' })
  assert.equal(applied.values.fields.estimate, 'native')
  const two = describe()
  two.teams[0].candidates['mappings.fields.estimate'] = ['native', 'Points']
  assert.ok(paths(proposeMappings(two, {}, {})).includes('mappings.fields.estimate'))
  const none = proposeMappings(describe(), {}, {})
  assert.deepEqual(none.notes, ['team has estimates off'])
  assert.ok(!paths(none).includes('mappings.fields.estimate'))
  assert.equal(none.values.fields.estimate, undefined)
})

test('each type is a question while current.types is absent, with the recommendation, and none when it exists', () => {
  const asked = proposeMappings(describe(), {}, {})
  assert.deepEqual(paths(asked).slice(2), ['mappings.types.feature', 'mappings.types.bug'])
  assert.equal(asked.questions[2].recommended, 'Feature')
  assert.equal(asked.questions[2].none, 'No label stands for this type')
  for (const types of [{}, { bug: 'Bug' }]) {
    const kept = proposeMappings(describe(), { status: { in_review: 'Review', blocked: NONE }, types }, {})
    assert.deepEqual(paths(kept), [], JSON.stringify(types))
    assert.deepEqual(kept.values.types, types)
  }
})

test('a label already given to one type is not offered to the next', () => {
  const result = proposeMappings(describe(), {}, { types: { feature: 'Bug' } })
  assert.deepEqual(result.questions.find((q) => q.path === 'mappings.types.bug').candidates, ['Feature', 'Docs'])
  assert.throws(() => proposeMappings(describe(), {}, { types: { feature: 'Bug', bug: 'Bug' } }), (error) => error.code === 'INVALID_INPUT')
})

test('an answer that is not a candidate fails with INVALID_INPUT and names the candidates', () => {
  assert.throws(() => proposeMappings(describe(), {}, { status: { in_review: 'Nope' } }), (error) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.message, '--status in_review=Nope is not a status of team AA')
    assert.equal(error.nextStep, 'Pass one of: Review, Doing, none')
    return true
  })
  assert.throws(() => proposeMappings(describe(), {}, { status: { done: 'x' } }), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => proposeMappings(describe(), {}, { types: { epic: 'x' } }), (error) => error.code === 'INVALID_INPUT')
  assert.throws(() => proposeMappings(describe(), {}, { workspace: 'other' }), (error) => error.code === 'INVALID_INPUT')
})

test('a state cannot mean both in review and blocked', () => {
  assert.throws(() => proposeMappings(describe(), {}, { status: { in_review: 'Doing', blocked: 'Doing' } }), (error) => error.code === 'INVALID_INPUT')
})

test('a type answered none is left out of the result and not asked again', () => {
  const answers = { status: { in_review: 'Review', blocked: NONE }, types: { feature: NONE, bug: 'Bug' } }
  const first = proposeMappings(describe(), {}, answers)
  assert.deepEqual(first.questions, [])
  assert.deepEqual(first.values.types, { bug: 'Bug' })
  const second = proposeMappings(describe(), { scope: { workspace: 'acme', team: 'AA' }, status: first.values.status, types: first.values.types }, {})
  assert.deepEqual(second.questions, [])
  assert.deepEqual(second.applied, [])
})

test('a kept value is not asked again and an answer wins over it', () => {
  const current = { scope: { workspace: 'acme', team: 'AA' }, status: { in_review: 'Review', blocked: 'Todo' }, types: {} }
  assert.deepEqual(paths(proposeMappings(describe(), current, {})), [])
  assert.equal(proposeMappings(describe(), current, { status: { blocked: NONE } }).values.status.blocked, NONE)
})

// brokenMappings and parseMappingFlags.
const fileOf = (extra = {}) => ({ tracker: { scope: { workspace: 'acme', team: 'AA' } }, mappings: {}, ...extra })

test('a missing team is one item and hides the rest', () => {
  assert.deepEqual(brokenMappings(describe(), { tracker: { scope: {} }, mappings: { status: { in_review: 'x' } } }),
    [{ path: 'tracker.scope.team', value: null, problem: 'tracker.scope.team is not set' }])
  assert.deepEqual(brokenMappings(describe(), {}).map((item) => item.problem), ['tracker.scope.team is not set'])
})

test('a team the workspace lost, a status, a field and a label each give their problem', () => {
  assert.deepEqual(brokenMappings(describe(), fileOf({ tracker: { scope: { team: 'ZZ' } } })),
    [{ path: 'tracker.scope.team', value: 'ZZ', problem: 'tracker.scope.team names ZZ, which this workspace no longer has' }])
  const d = describe()
  d.teams[0].exists = (path, value) => !['Gone', 'native', 'Lost'].includes(value)
  d.teams[0].problem = (path, value) => (path === 'mappings.fields.estimate' ? `${path} is ${value}, but team AA has estimates off` : undefined)
  const items = brokenMappings(d, fileOf({
    mappings: { status: { in_review: 'Gone', blocked: 'Fine' }, fields: { estimate: 'native' }, types: { bug: 'Lost', feature: 'Feature' } },
  }))
  assert.deepEqual(items.map((item) => [item.path, item.problem]), [
    ['mappings.status.in_review', 'mappings.status.in_review names Gone, which team AA no longer has'],
    ['mappings.fields.estimate', 'mappings.fields.estimate is native, but team AA has estimates off'],
    ['mappings.types.bug', 'mappings.types.bug names Lost, which team AA no longer has'],
  ])
})

test('none and absent keys are never broken, and a types entry is broken only when its label is missing', () => {
  const d = describe()
  d.teams[0].exists = () => false
  assert.deepEqual(brokenMappings(d, fileOf({ mappings: { status: { in_review: NONE, blocked: NONE }, fields: { estimate: NONE }, types: {} } })), [])
  assert.deepEqual(brokenMappings(d, fileOf()), [])
})

test('a broken value becomes a question with broken, and a broken team a team question', () => {
  const d = describe()
  d.teams[0].exists = (path, value) => value !== 'Gone'
  const current = { scope: { workspace: 'acme', team: 'AA' }, status: { in_review: 'Gone', blocked: NONE }, types: {} }
  const result = proposeMappings(d, current, {})
  assert.deepEqual(result.questions.map((q) => q.path), ['mappings.status.in_review'])
  assert.deepEqual(result.questions[0].broken, { was: 'Gone', problem: 'mappings.status.in_review names Gone, which team AA no longer has' })
  assert.deepEqual(result.broken.map((item) => item.path), ['mappings.status.in_review'])
  const lost = proposeMappings(d, { scope: { workspace: 'acme', team: 'ZZ' } }, {})
  assert.deepEqual(lost.questions.map((q) => q.path), ['tracker.scope.team'])
  assert.equal(lost.questions[0].broken.was, 'ZZ')
})

test('a broken hand-written key of each kind becomes a question that an answer repairs', () => {
  const d = describe()
  d.teams[0].exists = (path, value) => value !== 'Gone'
  d.teams[0].candidates['mappings.status.done'] = ['Shipped', 'Doing']
  d.teams[0].candidates['mappings.types.epic'] = ['Feature', 'Bug', 'Docs']
  const current = {
    scope: { workspace: 'acme', team: 'AA' },
    status: { in_review: 'Review', blocked: NONE, done: 'Gone' },
    fields: { points: 'Gone' },
    types: { bug: 'Bug', epic: 'Gone' },
  }
  const result = proposeMappings(d, current, {})
  const asked = ['mappings.status.done', 'mappings.fields.points', 'mappings.types.epic']
  assert.deepEqual(paths(result), asked)
  assert.deepEqual(result.broken.map((item) => item.path), asked)
  const [done, points, epic] = result.questions
  assert.deepEqual([done.flag, done.candidates, done.recommended, done.none, done.broken.was], ['--status done=<value>', ['Shipped', 'Doing'], NONE, 'No status means done', 'Gone'])
  assert.deepEqual([points.flag, points.candidates, points.recommended, points.none], ['--field points=<value>', [], NONE, 'No field holds the points'])
  // Bug is taken by the bug type, so the epic question does not offer it.
  assert.deepEqual([epic.flag, epic.candidates, epic.none], ['--type-label epic=<value>', ['Feature', 'Docs'], 'No label stands for this type'])
  assert.equal(result.values.types, undefined)

  const fixed = proposeMappings(d, current, { status: { done: 'Shipped' }, fields: { points: NONE }, types: { epic: NONE } })
  assert.deepEqual(fixed.questions, [])
  assert.equal(fixed.values.status.done, 'Shipped')
  assert.equal(fixed.values.fields.points, NONE)
  assert.deepEqual(fixed.values.types, { bug: 'Bug' })
  assert.throws(() => proposeMappings(d, current, { status: { done: 'Nope' } }), (error) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.message, '--status done=Nope is not a status of team AA')
    assert.equal(error.nextStep, 'Pass one of: Shipped, Doing, none')
    return true
  })
})

test('a hand-written key that still exists is kept and not asked', () => {
  const current = { scope: { workspace: 'acme', team: 'AA' }, status: { in_review: 'Review', blocked: NONE, done: 'Shipped' }, fields: { points: 'Size' }, types: { epic: 'Docs' } }
  const result = proposeMappings(describe(), current, {})
  assert.deepEqual(result.questions, [])
  assert.equal(result.values.status.done, 'Shipped')
  assert.equal(result.values.fields.points, 'Size')
  assert.deepEqual(result.values.types, { epic: 'Docs' })
})

test('parseMappingFlags keeps spaces, accepts repeated flags and refuses a flag without a value', () => {
  const ctx = (lists) => ({ list: (name) => lists[name] ?? [] })
  assert.deepEqual(parseMappingFlags(ctx({ status: ['in_review=In Review', 'blocked=none'], field: ['estimate=native'], 'type-label': ['bug=Bug', 'bug=Defect'] })),
    { status: { in_review: 'In Review', blocked: 'none' }, fields: { estimate: 'native' }, types: { bug: 'Defect' } })
  assert.deepEqual(parseMappingFlags(ctx({ status: ['a=b=c'] })).status, { a: 'b=c' })
  for (const flag of ['status', 'field', 'type-label']) {
    assert.throws(() => parseMappingFlags(ctx({ [flag]: ['in_review'] })), (error) => error.code === 'INVALID_INPUT')
    assert.throws(() => parseMappingFlags(ctx({ [flag]: ['=x'] })), (error) => error.code === 'INVALID_INPUT')
  }
})
