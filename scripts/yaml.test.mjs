import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FrontmatterError, joinFrontmatter, parseYaml, splitFrontmatter, stringifyYaml } from './lib/yaml.mjs'

const ISSUE_FILE = `---
id: ISS-7K3Q
title: Retry failed webhook deliveries
type: bug
status: in_progress
priority: high
estimate: 3
assignee: fred
labels: [backend, webhooks]
parent: EPC-2M9D
blocked_by: [ISS-4P8A]
sprint: 2026-11-02
due: 2026-11-14
branch: iss-7k3q-retry-webhooks
created: 2026-10-23T21:12:00Z
updated: 2026-10-24T13:40:00Z
---

## Description

Deliveries that fail with 5xx are dropped instead of retried.
`

const CONFIG_YAML = `version: 1
id_prefix: ISS
epic_prefix: EPC
statuses:
  triage: { category: triage }
  backlog: { category: backlog }
  todo: { category: todo }
  in_progress: { category: in_progress }
  in_review: { category: in_review }
  done: { category: done }
  canceled: { category: canceled }
default_status: backlog
types: [feature, bug, task, chore]
priorities: [urgent, high, medium, low]
labels: []
estimate:
  unit: points                   # points | hours | sizes
  scale: [1, 2, 3, 5, 8, 13]
members:
  fred: { name: Fred Vanelli, email: fredsvanelli@example.com, availability: 1 }
defaults:
  stale_days: 60
  stuck_business_days: 3
  sprint_length_days: 14
  sprint_start_weekday: mon
  velocity_window: 3
  status_update_window_days: 14
auto_commit: false
`

const SPRINT_YAML = `name: Sprint 2026-11-02
start: 2026-11-02
end: 2026-11-15
goal: Webhook retries and the billing export
state: active
capacity: { fred: 8, ana: 10 }
days_off:
  ana: [2026-11-06]
`

const issue = () => parseYaml(splitFrontmatter(ISSUE_FILE).yaml)

test('the issue frontmatter of the spec parses', () => {
  assert.deepEqual(issue(), {
    id: 'ISS-7K3Q',
    title: 'Retry failed webhook deliveries',
    type: 'bug',
    status: 'in_progress',
    priority: 'high',
    estimate: 3,
    assignee: 'fred',
    labels: ['backend', 'webhooks'],
    parent: 'EPC-2M9D',
    blocked_by: ['ISS-4P8A'],
    sprint: '2026-11-02',
    due: '2026-11-14',
    branch: 'iss-7k3q-retry-webhooks',
    created: '2026-10-23T21:12:00Z',
    updated: '2026-10-24T13:40:00Z',
  })
})

test('the .issues/config.yaml of the spec parses', () => {
  const config = parseYaml(CONFIG_YAML)
  assert.equal(config.statuses.triage.category, 'triage')
  assert.equal(config.members.fred.availability, 1)
  assert.deepEqual(config.estimate.scale, [1, 2, 3, 5, 8, 13])
  assert.deepEqual(config.labels, [])
  assert.equal(config.auto_commit, false)
})

test('the sprint file of the spec parses', () => {
  const sprint = parseYaml(SPRINT_YAML)
  assert.deepEqual(sprint.capacity, { fred: 8, ana: 10 })
  assert.deepEqual(sprint.days_off.ana, ['2026-11-06'])
  assert.equal(sprint.start, '2026-11-02')
})

test('stringifyYaml then parseYaml round-trips the spec objects', () => {
  const config = parseYaml(CONFIG_YAML)
  delete config.labels
  for (const object of [issue(), config, parseYaml(SPRINT_YAML)]) {
    assert.deepEqual(parseYaml(stringifyYaml(object)), object)
  }
})

test('stringifyYaml writes the sprint file as the spec shows it', () => {
  const text = stringifyYaml(parseYaml(SPRINT_YAML), { order: ['name', 'start', 'end', 'goal', 'state', 'capacity', 'days_off'] })
  assert.equal(text, SPRINT_YAML)
})

test('stringifyYaml writes keys in order, then alphabetically', () => {
  assert.equal(stringifyYaml({ b: 1, a: 2, z: 3, c: 4 }, { order: ['z', 'c'] }), 'z: 3\nc: 4\na: 2\nb: 1\n')
})

test('stringifyYaml skips undefined, null, empty strings, empty arrays and empty objects', () => {
  assert.equal(stringifyYaml({ a: undefined, b: null, c: '', d: [], e: {}, f: 0, g: false }), 'f: 0\ng: false\n')
})

test('stringifyYaml writes flow lists, flow maps and block maps', () => {
  const text = stringifyYaml({ list: ['a', 'b'], flat: { x: 1, y: 'two' }, deep: { inner: { k: 'v' }, tags: [1, 2] } })
  assert.equal(text, 'deep:\n  inner: { k: v }\n  tags: [1, 2]\nflat: { x: 1, y: two }\nlist: [a, b]\n')
})

test('stringifyYaml quotes scalars that would not read back as the same string', () => {
  const object = { title: 'a: b', note: '#x', n: '12', yes: 'true' }
  const text = stringifyYaml(object)
  assert.equal(text, 'n: "12"\nnote: "#x"\ntitle: "a: b"\nyes: "true"\n')
  assert.deepEqual(parseYaml(text), object)
})

test('stringifyYaml quotes every risky string and reads it back', () => {
  const risky = ['', ' lead', 'trail ', 'a #b', 'a [b]', 'a {b}', 'a, b', '-x', '?x', '&x', '*x', '!x', '|x', '>x', "'x", '"x', '%x', '@x', '`x', 'null', '~', 'false', '1.5', 'say "hi"', "it's", 'back\\slash']
  for (const value of risky) {
    const object = { value, list: [value], map: { value } }
    const text = stringifyYaml({ ...object, other: 1 }, {})
    const read = parseYaml(text)
    if (value === '') assert.equal(read.value, undefined)
    else assert.deepEqual({ value: read.value, list: read.list, map: read.map }, object, JSON.stringify(value))
  }
})

test('stringifyYaml leaves plain timestamps and dates unquoted', () => {
  assert.equal(stringifyYaml({ at: '2026-10-23T21:12:00Z', d: '2026-11-02' }), 'at: 2026-10-23T21:12:00Z\nd: 2026-11-02\n')
})

test('joinFrontmatter writes the delimiters and splitFrontmatter reads them back', () => {
  const text = joinFrontmatter({ id: 'ISS-1', title: 'Hi' }, '## Description\n', { order: ['id', 'title'] })
  assert.equal(text, '---\nid: ISS-1\ntitle: Hi\n---\n\n## Description\n')
  const { yaml, body } = splitFrontmatter(text)
  assert.deepEqual(parseYaml(yaml), { id: 'ISS-1', title: 'Hi' })
  assert.equal(body, '\n## Description\n')
})

test('joinFrontmatter with nothing to write still reads back', () => {
  const { yaml } = splitFrontmatter(joinFrontmatter({}, 'x\n'))
  assert.deepEqual(parseYaml(yaml), {})
})

test('splitFrontmatter accepts CRLF and a BOM', () => {
  const crlf = `\uFEFF${ISSUE_FILE.replace(/\n/g, '\r\n')}`
  const split = splitFrontmatter(crlf)
  assert.deepEqual(parseYaml(split.yaml), issue())
  assert.equal(split.body, splitFrontmatter(ISSUE_FILE).body)
})

test('stringifyYaml rejects a list of maps', () => {
  assert.throws(() => stringifyYaml({ a: [{ b: 1 }] }), TypeError)
})

test('parseYaml still throws FrontmatterError on bad input', () => {
  assert.throws(() => parseYaml('just text'), FrontmatterError)
})

test('keys may contain a colon not followed by a space', () => {
  const block = parseYaml('members:\n  agent:claude: { name: Claude, availability: 1 }\n  fred: { name: Fred }\n')
  assert.deepEqual(block, { members: { 'agent:claude': { name: 'Claude', availability: 1 }, fred: { name: 'Fred' } } })
  assert.deepEqual(parseYaml('capacity: { fred: 8, agent:claude: 5 }\n'), { capacity: { fred: 8, 'agent:claude': 5 } })
  assert.deepEqual(parseYaml('days_off:\n  agent:claude: [2026-11-06]\n'), { days_off: { 'agent:claude': ['2026-11-06'] } })
  assert.deepEqual(parseYaml('agent:claude:\n  a: 1\n'), { 'agent:claude': { a: 1 } })
})

test('stringifyYaml writes keys with a colon plain and they round-trip', () => {
  const object = {
    members: { 'agent:claude': { name: 'Claude', availability: 1 }, fred: { name: 'Fred' } },
    capacity: { fred: 8, 'agent:claude': 5 },
    days_off: { 'agent:claude': ['2026-11-06'] },
  }
  const text = stringifyYaml(object)
  assert.match(text, /^capacity: \{ fred: 8, agent:claude: 5 \}$/m)
  assert.match(text, /^ {2}agent:claude: \{ name: Claude, availability: 1 \}$/m)
  assert.deepEqual(parseYaml(text), object)
  assert.deepEqual(parseYaml(stringifyYaml({ m: { 'agent:claude': 1 } })), { m: { 'agent:claude': 1 } })
})

test('flow-map entries without a space after the colon still parse', () => {
  assert.deepEqual(parseYaml('m: { a:1 }\n'), { m: { a: 1 } })
  assert.deepEqual(parseYaml('m: { a:[1] }\n'), { m: { a: [1] } })
  assert.deepEqual(parseYaml('m: { a:[1, 2] }\n'), { m: { a: [1, 2] } })
  assert.deepEqual(parseYaml('m: { a:"x" }\n'), { m: { a: 'x' } })
  assert.deepEqual(parseYaml('m: { a:1, b: 2 }\n'), { m: { a: 1, b: 2 } })
  assert.deepEqual(parseYaml('m: { fred: 8, agent:claude: 5 }\n'), { m: { fred: 8, 'agent:claude': 5 } })
  assert.deepEqual(parseYaml('m: { agent:claude: 5 }\n'), { m: { 'agent:claude': 5 } })
  assert.deepEqual(parseYaml('m: { a:"x: y" }\n'), { m: { a: 'x: y' } })
})

test('quote characters inside a flow-map key stay part of the key', () => {
  assert.deepEqual(parseYaml("m: { don't: 1 }\n"), { m: { "don't": 1 } })
  assert.deepEqual(parseYaml("m: { a:1, don't: 2 }\n"), { m: { a: 1, "don't": 2 } })
  assert.deepEqual(parseYaml('m: { a"b: 1 }\n'), { m: { 'a"b': 1 } })
  assert.deepEqual(parseYaml("m: { a: [don't, x], b: 2 }\n"), { m: { a: ["don't", 'x'], b: 2 } })
})

test('stringifyYaml refuses NaN and Infinity, which would not read back as numbers', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => stringifyYaml({ estimate: value }), TypeError, String(value))
    assert.throws(() => stringifyYaml({ list: [1, value] }), TypeError, String(value))
  }
})

test('a block key that is not a plain word is written in double quotes and reads back', () => {
  const object = { records: { link: { 'blocks PMK-35 PMK-38': { state: 'done', uuid: 'u1' } }, comment: { 'PMK-38/2026-10-28T18-11-19Z-fred': { state: 'failed', error: { code: 'UPSTREAM', message: 'no: answer' } } } } }
  const text = stringifyYaml(object)
  assert.match(text, /^ {4}"blocks PMK-35 PMK-38": \{ state: done, uuid: u1 \}$/m)
  assert.match(text, /^ {4}"PMK-38\/2026-10-28T18-11-19Z-fred":$/m)
  assert.deepEqual(parseYaml(text), object)
})
