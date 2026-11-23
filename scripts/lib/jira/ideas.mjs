// Jira Product Discovery ideas (PMK-83): one JPD project's ideas with their votes and connected epics, and the delivery
// link from an idea to an epic of the configured space. Insights are not in Jira's REST API, so they stay unread (null).
import { PmkitError } from '../errors.mjs'
import { compareIds } from '../ids.mjs'
import { API, isIssueKey, issuePath, lower, normalizeKey } from './ids.mjs'

export const IDEAS_HINT = (site) => `Create a Jira Product Discovery project on ${site}, or check that the token's owner can browse one`
export const INSIGHTS_UNREAD = "Jira's REST API does not return Jira Product Discovery insights, so insights are unread"

const DELIVERY = ['polaris work item link', 'polaris issue link']
const VOTES = 'jira.polaris:votes'
const IMPLEMENTS = 'implements'

const discoveryProjects = (raw) => (raw.spaces ?? []).filter((space) => space.type === 'product_discovery')
const deliveryType = (raw) => (raw.linkTypes ?? []).find((type) => DELIVERY.includes(lower(type.name))) ?? null
const keyPrefix = (key) => key.slice(0, key.lastIndexOf('-'))
const notAnIdea = (key, site) => new PmkitError('NOT_FOUND', `${key} is not an idea of a Jira Product Discovery project on ${site}`, 'Pass the key of an idea that jira ideas list shows')

const sortedKeys = (keys) => [...new Set(keys.filter(Boolean))].sort(compareIds)

/** The keys on the other side of an item's delivery links, either direction, sorted. */
const epicsOf = (item) =>
  sortedKeys((item?.fields?.issuelinks ?? []).filter((entry) => DELIVERY.includes(lower(entry.type?.name))).map((entry) => entry.inwardIssue?.key ?? entry.outwardIssue?.key))

/** The keys linked to an idea by `type` on the implementing side, sorted: the inward side when the outward text is "implements". */
const implementersOf = (item, type) =>
  sortedKeys(
    (item?.fields?.issuelinks ?? [])
      .filter((entry) => lower(entry.type?.name) === lower(type.name))
      .map((entry) => (lower(type.outward) === IMPLEMENTS ? entry.inwardIssue?.key : entry.outwardIssue?.key)),
  )

const toIdea = (item, votesFields) => ({
  id: item.key,
  title: item.fields?.summary ?? null,
  status: item.fields?.status?.name ?? null,
  votes: votesFields.map((field) => ({ field: field.name, value: typeof item.fields?.[field.id] === 'number' ? item.fields[field.id] : null })),
  insights: null,
  epics: epicsOf(item),
})

export function ideaOperations({ client, site, discovery, epics, requireActor }) {
  const off = () => ({ available: false, reason: 'no_discovery_project', enableHint: IDEAS_HINT(site), site })

  /** The discovery, read from Jira once more when the cached one lacks what `complete` needs, so a project or link type just added counts. */
  async function current(complete) {
    let found = await discovery()
    if (!found.fresh && !complete(found.raw)) found = await discovery({ refresh: true })
    return found.raw
  }

  const named = (projects, project) => projects.find((space) => lower(space.key) === lower(project))

  /** The JPD project named by `project`, or the site's only one; null when the site has none and no project is named. */
  function chooseProject(projects, project) {
    if (project !== undefined) {
      const found = named(projects, project)
      if (!found) {
        throw new PmkitError('NOT_FOUND', `${site} has no Jira Product Discovery project ${project}`, projects.length === 0 ? IDEAS_HINT(site) : `Pass one of ${projects.map((space) => space.key).join(', ')}`)
      }
      return found
    }
    if (projects.length === 0) return null
    if (projects.length > 1) {
      throw new PmkitError('INVALID_INPUT', `${site} has several Jira Product Discovery projects: ${projects.map((space) => space.key).join(', ')}`, 'Pass --project KEY')
    }
    return projects[0]
  }

  async function votesFields(projectId) {
    const fields = (await client.request('GET', `${API}/field`)) ?? []
    return fields.filter((field) => field.schema?.custom === VOTES && (!field.scope || field.scope.project?.id === projectId))
  }

  async function list({ project, limit = 50 } = {}) {
    const raw = await current((found) => (project === undefined ? discoveryProjects(found).length > 0 : Boolean(named(discoveryProjects(found), project))))
    const chosen = chooseProject(discoveryProjects(raw), project)
    if (!chosen) return { ...off(), ideas: [], hasMore: false }
    const votes = await votesFields(chosen.id)
    const query = { jql: `project = "${chosen.key}" ORDER BY created DESC, key DESC`, fields: ['summary', 'status', 'issuelinks', ...votes.map((field) => field.id)].join(',') }
    const { items, hasMore } = await client.paginate(`${API}/search/jql`, { query, key: 'issues', pageSize: Math.min(limit, 100), limit })
    const ideas = items.map((item) => toIdea(item, votes))
    const unvoted = ideas.filter((idea) => idea.votes.some((vote) => vote.value === null)).length
    const warnings = [
      ...(ideas.length > 0 ? [INSIGHTS_UNREAD] : []),
      ...(votes.length === 0 ? [`${chosen.key} has no votes field, so votes are unread`] : []),
      ...(unvoted > 0 ? [`Jira did not return the votes of ${unvoted} ideas`] : []),
    ]
    return { available: true, site, project: { key: chosen.key, name: chosen.name }, ideas, hasMore, warnings }
  }

  async function readIdea(key) {
    try {
      return await client.request('GET', issuePath(key), { query: { fields: 'issuelinks' } })
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw notAnIdea(key, site)
      throw error
    }
  }

  async function connect(idea, epic, actor, { dryRun = false } = {}) {
    await requireActor(actor)
    const key = normalizeKey(idea)
    const isIdea = (found) => isIssueKey(key) && discoveryProjects(found).some((space) => space.key === keyPrefix(key))
    const discovered = await current((found) => !isIssueKey(key) || (isIdea(found) && deliveryType(found) !== null))
    if (!isIdea(discovered)) throw notAnIdea(key, site)
    if (discovered.linkTypes === null) {
      throw new PmkitError('NOT_SUPPORTED', `Jira's link types could not be read on ${site}, so pmkit cannot find Jira Product Discovery's delivery link type`, "Check that the token's owner can browse the link types, then run pmkit discover")
    }
    const type = deliveryType(discovered)
    if (!type) throw new PmkitError('NOT_SUPPORTED', `Jira Product Discovery's delivery link type is missing on ${site}`, 'Check that Jira Product Discovery is installed and its "Polaris work item link" type exists')
    if (lower(type.outward) !== IMPLEMENTS && lower(type.inward) !== IMPLEMENTS) {
      throw new PmkitError('NOT_SUPPORTED', `Jira Product Discovery's delivery link type ${type.name} does not say which side implements the idea`, `Check the "${type.name}" link type in Jira's settings`)
    }
    const before = implementersOf(await readIdea(key), type)
    const target = (await epics.getDeliverable(epic)).id
    const result = (after) => ({ idea: key, epic: target, linkType: type.name, before: { epics: before }, after: { epics: after } })
    if (before.includes(target)) return result(before)
    if (dryRun) return result([...before, target].sort(compareIds))
    // inwardIssue <outward> outwardIssue: the epic is the side whose text is "implements".
    const [inward, outward] = lower(type.outward) === IMPLEMENTS ? [target, key] : [key, target]
    await client.request('POST', `${API}/issueLink`, { body: { type: { name: type.name }, inwardIssue: { key: inward }, outwardIssue: { key: outward } } })
    return result(implementersOf(await readIdea(key), type))
  }

  return { list, connect }
}
