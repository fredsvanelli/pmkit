import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateSchema } from './json-schema-subset.mjs'
import {
  CONFIRM, ESTIMATE_UNITS, GIT_HOSTS, MEMBER_ID, PREFIX, PREVIEW, TRACKERS, WEEKDAYS,
  localConfigShapeProblems, validatePmkitConfig, withLocalDefaults,
} from './lib/config.mjs'
import { ID_STYLES } from './lib/ids.mjs'
import { CATEGORIES } from './lib/model.mjs'
import { parseYaml } from './lib/yaml.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const loadSchema = (name) => JSON.parse(read(`schemas/${name}.config.schema.json`))

const FILES = {
  pmkit: {
    file: '.pmkit/config.yaml',
    validate: validatePmkitConfig,
    base: () => parseYaml(read('templates/pmkit.config.yaml')),
  },
  issues: {
    file: '.issues/config.yaml',
    validate: localConfigShapeProblems,
    base: () => ({
      ...parseYaml(read('templates/issues.config.yaml')),
      members: { fred: { name: 'Fred', email: 'fred@example.com', availability: 0.5 } },
    }),
  },
}

const CONSTANTS = { TRACKERS, GIT_HOSTS, CONFIRM, PREVIEW, WEEKDAYS, ESTIMATE_UNITS, CATEGORIES, ID_STYLES }

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---------------------------------------------------------------------------
// The evaluator, one test per keyword.

test('type matches each JSON type, an array of types, and integer as Number.isInteger', () => {
  const cases = [
    ['null', null, 'x'], ['boolean', true, 0], ['string', '', 1], ['number', 0.5, '1'],
    ['integer', 3, 3.5], ['array', [], {}], ['object', {}, []],
  ]
  for (const [type, good, bad] of cases) {
    assert.deepEqual(validateSchema({ type }, good), [], `${type} accepts ${JSON.stringify(good)}`)
    assert.equal(validateSchema({ type }, bad).length, 1, `${type} rejects ${JSON.stringify(bad)}`)
  }
  assert.equal(validateSchema({ type: 'object' }, null).length, 1, 'object rejects null')
  assert.equal(validateSchema({ type: 'integer' }, '1').length, 1, 'integer rejects a string')
  assert.deepEqual(validateSchema({ type: ['string', 'null'] }, null), [])
  assert.deepEqual(validateSchema({ type: ['string', 'null'] }, 'x'), [])
  assert.equal(validateSchema({ type: ['string', 'null'] }, 1).length, 1)
})

test('enum accepts a listed value and rejects any other, by deep equality', () => {
  assert.deepEqual(validateSchema({ enum: ['a', 1, [2]] }, 'a'), [])
  assert.deepEqual(validateSchema({ enum: ['a', 1, [2]] }, [2]), [])
  assert.equal(validateSchema({ enum: ['a', 1] }, 'b').length, 1)
  assert.equal(validateSchema({ enum: ['1'] }, 1).length, 1)
})

test('const accepts only its value', () => {
  assert.deepEqual(validateSchema({ const: 1 }, 1), [])
  assert.equal(validateSchema({ const: 1 }, '1').length, 1)
  assert.equal(validateSchema({ const: 1 }, true).length, 1)
})

test('pattern tests strings and ignores other types', () => {
  assert.deepEqual(validateSchema({ pattern: '^[A-Z]{2}$' }, 'AB'), [])
  assert.equal(validateSchema({ pattern: '^[A-Z]{2}$' }, 'ab').length, 1)
  assert.deepEqual(validateSchema({ pattern: '^[A-Z]{2}$' }, 5), [])
})

test('minimum is inclusive and ignores other types', () => {
  assert.deepEqual(validateSchema({ minimum: 1 }, 1), [])
  assert.equal(validateSchema({ minimum: 1 }, 0.5).length, 1)
  assert.deepEqual(validateSchema({ minimum: 1 }, 'x'), [])
})

test('maximum is inclusive and ignores other types', () => {
  assert.deepEqual(validateSchema({ maximum: 1 }, 1), [])
  assert.equal(validateSchema({ maximum: 1 }, 1.5).length, 1)
  assert.deepEqual(validateSchema({ maximum: 1 }, 'x'), [])
})

test('minItems counts array items and ignores other types', () => {
  assert.deepEqual(validateSchema({ minItems: 1 }, ['x']), [])
  assert.equal(validateSchema({ minItems: 1 }, []).length, 1)
  assert.deepEqual(validateSchema({ minItems: 1 }, ''), [])
})

test('items applies its schema to each item and names the index', () => {
  assert.deepEqual(validateSchema({ items: { type: 'string' } }, ['a', 'b']), [])
  const errors = validateSchema({ items: { type: 'string' } }, ['a', 1])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /\[1\]/)
  assert.deepEqual(validateSchema({ items: { type: 'string' } }, 'not a list'), [])
})

test('properties applies to present keys only and names the key path', () => {
  const schema = { properties: { a: { properties: { b: { type: 'string' } } } } }
  assert.deepEqual(validateSchema(schema, {}), [])
  assert.deepEqual(validateSchema(schema, { a: { b: 'x' } }), [])
  const errors = validateSchema(schema, { a: { b: 1 } })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /a\.b/)
  assert.deepEqual(validateSchema(schema, []), [], 'properties ignores an array')
})

test('required reports each missing key', () => {
  assert.deepEqual(validateSchema({ required: ['a'] }, { a: null }), [])
  assert.equal(validateSchema({ required: ['a', 'b'] }, {}).length, 2)
  assert.deepEqual(validateSchema({ required: ['a'] }, ['a']), [], 'required ignores an array')
})

test('additionalProperties applies to keys absent from properties only', () => {
  const schema = { properties: { a: { type: 'string' } }, additionalProperties: { type: 'integer' } }
  assert.deepEqual(validateSchema(schema, { a: 'x', b: 1 }), [])
  assert.equal(validateSchema(schema, { a: 'x', b: 'y' }).length, 1)
  assert.equal(validateSchema(schema, { a: 1 }).length, 1, 'a is checked by properties, not by additionalProperties')
})

test('propertyNames applies its schema to each key', () => {
  const schema = { propertyNames: { pattern: '^[a-z]+$' } }
  assert.deepEqual(validateSchema(schema, { fred: 1 }), [])
  assert.equal(validateSchema(schema, { Fred: 1 }).length, 1)
})

test('a keyword outside the list throws, even where the value does not reach it', () => {
  assert.throws(() => validateSchema({ oneOf: [] }, 1), { message: 'unsupported keyword oneOf at #' })
  assert.throws(() => validateSchema({ format: 'x' }, 'x'), { message: 'unsupported keyword format at #' })
  assert.throws(() => validateSchema({ properties: { a: { if: {} } } }, {}), { message: 'unsupported keyword if at #/properties/a' })
  assert.doesNotThrow(() => validateSchema({ $schema: 'x', title: 't', description: 'd', default: 1 }, 1))
})

// ---------------------------------------------------------------------------
// Helpers for the schema checks.

/** Every key path of a plain value, depth first. Arrays are leaves. */
function valuePaths(value, prefix = []) {
  if (!isMap(value)) return []
  return Object.entries(value).flatMap(([key, child]) => [[...prefix, key], ...valuePaths(child, [...prefix, key])])
}

/** The subschema that applies to a key path, through properties or a map's additionalProperties. */
function schemaAt(schema, keys) {
  let current = schema
  for (const key of keys) {
    if (!isMap(current)) return undefined
    current = current.properties?.[key] ?? (isMap(current.additionalProperties) ? current.additionalProperties : undefined)
  }
  return current
}

/** Every property path of a schema. A map's entries take the first key the base config has in that map. */
function schemaPaths(schema, base, prefix = []) {
  const paths = []
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    paths.push([...prefix, key], ...schemaPaths(child, base?.[key], [...prefix, key]))
  }
  const entry = schema.additionalProperties
  const first = isMap(base) ? Object.keys(base).find((key) => !schema.properties?.[key]) : undefined
  if (isMap(entry) && entry.properties && first !== undefined) {
    paths.push([...prefix, first], ...schemaPaths(entry, base[first], [...prefix, first]))
  }
  return paths
}

/** Every subschema with its location, through properties, additionalProperties, items and propertyNames. */
function subschemas(schema, at = []) {
  if (!isMap(schema)) return []
  const children = [
    ...Object.entries(schema.properties ?? {}).map(([key, child]) => [child, [...at, key]]),
    [schema.additionalProperties, [...at, '*']],
    [schema.items, [...at, '[]']],
    [schema.propertyNames, [...at, '<key>']],
  ]
  return [[schema, at], ...children.flatMap(([child, where]) => subschemas(child, where))]
}

/** Paths of the maps whose keys the user picks: objects whose additionalProperties is a schema. */
const mapPaths = (schema) => subschemas(schema).filter(([s]) => isMap(s.additionalProperties)).map(([, at]) => at)

const ABSENT = Symbol('absent')
const BASE_PROBES = [ABSENT, null, '', 'x', 0, 1, -1, 0.5, true, [], ['x'], [1], {}, { x: 1 }, 'AB', 'ABCDEF', 'ab', 'agent:claude', 'Fred']
const NEW_KEYS = ['extra', 'agent:claude', 'Fred']

function probesFor(schema) {
  const values = [...BASE_PROBES, ...Object.values(CONSTANTS).flat()]
  for (const [s] of subschemas(schema)) {
    if (s.enum) values.push(...s.enum)
    if ('const' in s) values.push(s.const)
  }
  const seen = new Set()
  return values.filter((value) => {
    const key = value === ABSENT ? 'absent' : JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const describe = (probe) => (probe === ABSENT ? 'absent' : JSON.stringify(probe))

function withProbe(base, keys, probe) {
  const config = structuredClone(base)
  let parent = config
  for (const key of keys.slice(0, -1)) {
    if (!isMap(parent[key])) parent[key] = {}
    parent = parent[key]
  }
  if (probe === ABSENT) delete parent[keys.at(-1)]
  else parent[keys.at(-1)] = structuredClone(probe)
  return config
}

/** Every case where the schema and the validator give different verdicts, as readable lines. */
function verdictMismatches(name, schema, { file, validate, base: makeBase }) {
  const base = makeBase()
  const seen = new Set()
  const paths = [...valuePaths(base), ...schemaPaths(schema, base)].filter((keys) => {
    const key = keys.join('\u0000')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const probes = probesFor(schema)
  const cases = paths.flatMap((keys) => probes.map((probe) => [keys, probe]))
  for (const map of mapPaths(schema)) {
    for (const key of NEW_KEYS) cases.push(...probes.filter((probe) => probe !== ABSENT).map((probe) => [[...map, key], probe]))
  }
  const mismatches = []
  for (const [keys, probe] of cases) {
    const config = withProbe(base, keys, probe)
    const bySchema = validateSchema(schema, config).length === 0 ? 'valid' : 'invalid'
    const byValidator = validate(config).length === 0 ? 'valid' : 'invalid'
    if (bySchema !== byValidator) {
      mismatches.push(`${file} (${name}) ${keys.join('.')} = ${describe(probe)}: schema ${bySchema}, validator ${byValidator}`)
    }
  }
  return mismatches
}

// ---------------------------------------------------------------------------
// Structural checks.

test('each schema declares draft-07, has no $id, and has a title and a description on the root and on every key', () => {
  for (const name of Object.keys(FILES)) {
    const schema = loadSchema(name)
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#', name)
    assert.equal(schema.$id, undefined, name)
    for (const [s, at] of subschemas(schema)) {
      if (at.at(-1) === '[]' || at.at(-1) === '<key>') continue
      assert.equal(typeof s.title, 'string', `${name} ${at.join('.') || 'root'} title`)
      assert.equal(typeof s.description, 'string', `${name} ${at.join('.') || 'root'} description`)
    }
  }
})

test('no schema object sets additionalProperties to false', () => {
  for (const name of Object.keys(FILES)) {
    for (const [s, at] of subschemas(loadSchema(name))) {
      assert.notEqual(s.additionalProperties, false, `${name} ${at.join('.') || 'root'}`)
    }
  }
})

test('the issues schema has a default wherever the config defaults have one, with the same value', () => {
  const schema = loadSchema('issues')
  const defaults = withLocalDefaults({})
  delete defaults.statuses
  for (const keys of valuePaths(defaults)) {
    const expected = keys.reduce((value, key) => value[key], defaults)
    assert.deepEqual(schemaAt(schema, keys)?.default, expected, `default of ${keys.join('.')}`)
  }
})

const PINNED = {
  pmkit: {
    'version const': [(s) => s.properties.version.const, 1],
    'tracker.system enum': [(s) => schemaAt(s, ['tracker', 'system']).enum, TRACKERS],
    'git_host.system enum': [(s) => schemaAt(s, ['git_host', 'system']).enum, GIT_HOSTS],
    'write_policy.confirm enum': [(s) => schemaAt(s, ['write_policy', 'confirm']).enum, CONFIRM],
    'write_policy.preview.[] enum': [(s) => schemaAt(s, ['write_policy', 'preview']).items.enum, PREVIEW],
  },
  issues: {
    'id_prefix pattern': [(s) => s.properties.id_prefix.pattern, PREFIX.source],
    'epic_prefix pattern': [(s) => s.properties.epic_prefix.pattern, PREFIX.source],
    'id_style enum': [(s) => s.properties.id_style.enum, ID_STYLES],
    'statuses.*.category enum': [(s) => s.properties.statuses.additionalProperties.properties.category.enum, CATEGORIES],
    'estimate.unit enum': [(s) => schemaAt(s, ['estimate', 'unit']).enum, ESTIMATE_UNITS],
    'members.<key> pattern': [(s) => s.properties.members.propertyNames.pattern, MEMBER_ID.source],
    'defaults.sprint_start_weekday enum': [(s) => schemaAt(s, ['defaults', 'sprint_start_weekday']).enum, WEEKDAYS],
  },
}

test('every enum, const and pattern in the schemas equals the constant its validator uses', () => {
  for (const [name, pinned] of Object.entries(PINNED)) {
    const schema = loadSchema(name)
    for (const [label, [pick, expected]] of Object.entries(pinned)) {
      assert.deepEqual(pick(schema), expected, `${name} ${label}`)
    }
    const found = subschemas(schema).flatMap(([s, at]) =>
      ['enum', 'const', 'pattern'].filter((keyword) => keyword in s).map((keyword) => `${at.join('.')} ${keyword}`))
    assert.deepEqual(found.sort(), Object.keys(pinned).sort(), `${name}: an enum, const or pattern with no pinned constant`)
  }
})

test('every key path of each template has a schema', () => {
  for (const name of Object.keys(FILES)) {
    const schema = loadSchema(name)
    const template = parseYaml(read(`templates/${name}.config.yaml`))
    for (const keys of valuePaths(template)) {
      assert.ok(schemaAt(schema, keys), `${name} template key ${keys.join('.')} has no schema`)
    }
  }
})

test('the user-keyed maps are statuses, members and defaults', () => {
  assert.deepEqual(mapPaths(loadSchema('pmkit')), [])
  assert.deepEqual(mapPaths(loadSchema('issues')).map((keys) => keys.join('.')), ['statuses', 'members', 'defaults'])
})

// ---------------------------------------------------------------------------
// Verdict checks.

test('the base config of each file is valid for its schema and its validator', () => {
  for (const [name, spec] of Object.entries(FILES)) {
    const base = spec.base()
    assert.deepEqual(validateSchema(loadSchema(name), base), [], `${name} schema`)
    assert.deepEqual(spec.validate(base), [], `${name} validator`)
  }
})

test('the pmkit schema and validatePmkitConfig give the same verdict on every probe', () => {
  assert.deepEqual(verdictMismatches('pmkit', loadSchema('pmkit'), FILES.pmkit), [])
})

test('the issues schema and localConfigShapeProblems give the same verdict on every probe', () => {
  assert.deepEqual(verdictMismatches('issues', loadSchema('issues'), FILES.issues), [])
})

test('null for an optional key is invalid on both sides, and tracker.path null is valid on both', () => {
  const cases = [
    ['pmkit', ['tracker', 'path'], true],
    ['pmkit', ['git_host', 'repo'], false],
    ['pmkit', ['git_host', 'default_branch'], false],
    ['pmkit', ['write_policy', 'preview'], false],
    ['issues', ['id_style'], false],
    ['issues', ['labels'], false],
    ['issues', ['estimate', 'scale'], false],
    ['issues', ['members'], false],
    ['issues', ['members', 'fred', 'name'], false],
    ['issues', ['members', 'fred', 'email'], false],
    ['issues', ['members', 'fred', 'availability'], false],
    ['issues', ['defaults'], false],
    ['issues', ['auto_commit'], false],
  ]
  for (const [name, keys, valid] of cases) {
    const config = withProbe(FILES[name].base(), keys, null)
    const label = `${name} ${keys.join('.')}: null`
    assert.equal(validateSchema(loadSchema(name), config).length === 0, valid, `${label} (schema)`)
    assert.equal(FILES[name].validate(config).length === 0, valid, `${label} (validator)`)
  }
})

test('the verdict check reports a schema that drifts from its validator', () => {
  const schema = structuredClone(loadSchema('issues'))
  const unit = schema.properties.estimate.properties.unit
  unit.enum = unit.enum.filter((value) => value !== 'sizes')
  schema.required.push('labels')
  delete schema.properties.auto_commit
  const mismatches = verdictMismatches('issues', schema, FILES.issues)
  for (const expected of [
    '.issues/config.yaml (issues) estimate.unit = "sizes": schema invalid, validator valid',
    '.issues/config.yaml (issues) labels = absent: schema invalid, validator valid',
    '.issues/config.yaml (issues) auto_commit = "x": schema valid, validator invalid',
  ]) {
    assert.ok(mismatches.includes(expected), `missing: ${expected}`)
  }
})
