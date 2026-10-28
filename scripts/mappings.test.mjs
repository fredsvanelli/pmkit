import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NONE, proposeMappings } from './lib/mappings.mjs'

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
