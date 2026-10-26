// Test helper: a JSON Schema draft-07 evaluator for the keywords the config schemas use, and no others.
// A schema that uses any other keyword makes it throw, so a check it cannot run never passes silently.
import { isDeepStrictEqual } from 'node:util'

const KEYWORDS = new Set([
  'type', 'enum', 'const', 'pattern', 'minimum', 'maximum', 'minItems',
  'items', 'properties', 'required', 'additionalProperties', 'propertyNames',
])
const ANNOTATIONS = new Set(['$schema', 'title', 'description', 'default'])

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const TYPES = {
  null: (value) => value === null,
  boolean: (value) => typeof value === 'boolean',
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  integer: (value) => Number.isInteger(value),
  array: (value) => Array.isArray(value),
  object: isMap,
}

function checkKeywords(schema, at) {
  if (typeof schema === 'boolean') return
  if (!isMap(schema)) throw new Error(`schema at ${at} must be an object or a boolean`)
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`unsupported keyword ${key} at ${at}`)
  }
  if ('type' in schema) {
    for (const type of [].concat(schema.type)) {
      if (!Object.hasOwn(TYPES, type)) throw new Error(`unsupported type ${type} at ${at}`)
    }
  }
  if (Array.isArray(schema.items)) throw new Error(`unsupported keyword items (list form) at ${at}`)
  for (const [key, child] of Object.entries(schema.properties ?? {})) checkKeywords(child, `${at}/properties/${key}`)
  for (const key of ['additionalProperties', 'items', 'propertyNames']) {
    if (key in schema) checkKeywords(schema[key], `${at}/${key}`)
  }
}

function collect(schema, value, at, errors) {
  if (schema === true) return
  if (schema === false) {
    errors.push(`${at}: is not allowed`)
    return
  }
  if ('type' in schema) {
    const types = [].concat(schema.type)
    if (!types.some((type) => TYPES[type](value))) errors.push(`${at}: must be ${types.join(' or ')}`)
  }
  if ('enum' in schema && !schema.enum.some((option) => isDeepStrictEqual(option, value))) {
    errors.push(`${at}: must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`)
  }
  if ('const' in schema && !isDeepStrictEqual(schema.const, value)) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`)

  if (typeof value === 'string' && 'pattern' in schema && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${at}: must match ${schema.pattern}`)
  }
  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) errors.push(`${at}: must be ${schema.minimum} or more`)
    if ('maximum' in schema && value > schema.maximum) errors.push(`${at}: must be ${schema.maximum} or less`)
  }
  if (Array.isArray(value)) {
    if ('minItems' in schema && value.length < schema.minItems) errors.push(`${at}: must have at least ${schema.minItems} items`)
    if ('items' in schema) value.forEach((item, index) => collect(schema.items, item, `${at}[${index}]`, errors))
  }
  if (isMap(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${at}: missing ${key}`)
    }
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(value)) {
      if ('propertyNames' in schema) collect(schema.propertyNames, key, `${at} key ${JSON.stringify(key)}`, errors)
      if (Object.hasOwn(properties, key)) collect(properties[key], child, `${at}.${key}`, errors)
      else if ('additionalProperties' in schema) collect(schema.additionalProperties, child, `${at}.${key}`, errors)
    }
  }
}

/** The errors of `value` against `schema`, each starting with the value path (`$` is the root). Throws on a keyword outside the supported list. */
export function validateSchema(schema, value) {
  checkKeywords(schema, '#')
  const errors = []
  collect(schema, value, '$', errors)
  return errors
}
