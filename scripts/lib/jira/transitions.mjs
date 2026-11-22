import { PmkitError } from '../errors.mjs'
import { textToAdf } from './adf.mjs'

const SETUP = '/pmkit:setup'
const DATE = /^\d{4}-\d{2}-\d{2}$/

const invalid = (message, nextStep, details) => new PmkitError('INVALID_INPUT', message, nextStep, details)
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
const labelOf = (option) => String(option.name ?? option.value ?? option.id)

// The statuses of the item's work type, in Jira's order, as { id, name, category }.
function statusesOf(item, context) {
  const workType = context.raw.workTypes.find((type) => type.id === String(item.fields.issuetype?.id))
  const byId = new Map(context.raw.statuses.map((status) => [status.id, status]))
  const statuses = (workType?.statuses ?? []).map((id) => byId.get(id)).filter(Boolean)
  return { workType, statuses: statuses.map((status) => ({ id: status.id, name: status.name, category: context.categoryOf(status.name, status.categoryKey) })) }
}

// The status a move to the category goes to: the named one, the mapped one, else the first of the category.
export function pickTarget({ item, category, status, context }) {
  const { workType, statuses } = statusesOf(item, context)
  const inCategory = statuses.filter((candidate) => candidate.category === category)
  const pick = (found) => ({ id: found.id, name: found.name })
  if (status !== undefined && status !== null) {
    const found = inCategory.find((candidate) => candidate.id === String(status) || same(candidate.name, status))
    if (!found) throw invalid(`status ${status} is not a ${category} status of work type ${workType?.name ?? item.fields.issuetype?.name}; its ${category} statuses: ${inCategory.map((s) => s.name).join(', ') || 'none'}`, `Use one of: ${inCategory.map((s) => s.name).join(', ')}`)
    return pick(found)
  }
  const mapped = context.pmkit?.mappings?.status?.[category]
  const found = inCategory.find((candidate) => candidate.name === mapped) ?? inCategory[0]
  if (!found) throw new PmkitError('NOT_SUPPORTED', `work type ${workType?.name ?? item.fields.issuetype?.name} in space ${context.space} has no status in the ${category} category`, SETUP)
  return pick(found)
}

// The transition that leads to the target, or an error naming the statuses the item can reach.
export function pickTransition(transitions, target, item) {
  const found = transitions.find((transition) => String(transition.to?.id) === String(target.id))
  if (found) return found
  const reachable = transitions.map((transition) => transition.to?.name).filter(Boolean)
  throw invalid(`Jira's workflow has no transition from ${item.fields.status?.name} to ${target.name} for ${item.key}`, `Move it to one of: ${reachable.join(', ')}`)
}

// The screen fields a transition needs a value for: required and without a default.
export function requiredFields(transition) {
  return Object.entries(transition.fields ?? {})
    .filter(([, field]) => field.required === true && field.hasDefaultValue !== true)
    .map(([id, field]) => ({ id, name: field.name, type: field.schema?.type, allowed: (field.allowedValues ?? []).map(labelOf) }))
}

const isTextArea = (schema) => schema?.type === 'string' && String(schema.custom ?? '').endsWith(':textarea')

function fromAllowed(field, id, value) {
  const option = field.allowedValues.find((candidate) => String(candidate.id) === value || same(candidate.name, value) || same(candidate.value, value))
  if (!option) throw invalid(`${field.name} (${id}) does not allow ${value}; it allows ${field.allowedValues.map(labelOf).join(', ')}`, `Use one of: ${field.allowedValues.map(labelOf).join(', ')}`)
  return field.schema?.type === 'array' ? [{ id: option.id }] : { id: option.id }
}

// One field's value as Jira takes it.
function convert(field, id, value, key) {
  if (Array.isArray(field.allowedValues) && field.allowedValues.length > 0) return fromAllowed(field, id, value)
  const type = field.schema?.type
  if (type === 'number') {
    if (value.trim() === '' || !Number.isFinite(Number(value))) throw invalid(`${field.name} (${id}) takes a number, not ${value}`)
    return Number(value)
  }
  if (type === 'date') {
    if (!DATE.test(value)) throw invalid(`${field.name} (${id}) takes a date as YYYY-MM-DD, not ${value}`)
    return value
  }
  if (type === 'string') return isTextArea(field.schema) ? textToAdf(value) : value
  throw new PmkitError('NOT_SUPPORTED', `pmkit cannot fill ${field.name} (${type}); move ${key} in Jira`)
}

const fillable = (field) => (field.allowedValues ?? []).length > 0 || ['number', 'date', 'string'].includes(field.schema?.type)

// The fields object for the transition from the given values; a missing required value is INVALID_INPUT with the list.
export function fieldValues(required, transition, given, { key, category, target }) {
  const known = transition.fields ?? {}
  for (const id of Object.keys(given ?? {})) {
    if (!Object.hasOwn(known, id)) throw invalid(`the transition to ${target} has no field ${id}`, `Use one of: ${Object.keys(known).join(', ') || 'no fields'}`)
  }
  for (const { id } of required) {
    if (!fillable(known[id])) throw new PmkitError('NOT_SUPPORTED', `pmkit cannot fill ${known[id].name} (${known[id].schema?.type}); move ${key} in Jira`)
  }
  const missing = required.filter(({ id }) => !Object.hasOwn(given ?? {}, id))
  if (missing.length > 0) {
    throw invalid(`the transition to ${target} needs ${missing.map((field) => field.name).join(', ')}`, `pmkit issues move ${key} ${category} --field ${missing[0].id}=<value>`, { requiredFields: missing })
  }
  return Object.fromEntries(Object.entries(given ?? {}).map(([id, value]) => [id, convert(known[id], id, String(value), key)]))
}
