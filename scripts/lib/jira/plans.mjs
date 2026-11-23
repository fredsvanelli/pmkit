// Jira Plans (Premium), read-only (PMK-82): the site's plans, a plan's default scenario, scheduling, releases and teams' capacity.
// Every Plans call answers 403 without Premium or the Administer Jira permission, which pmkit reports as the capability being absent.
import { PmkitError } from '../errors.mjs'

export const PLANS_HINT = "Jira Plans need Jira Premium or Enterprise, and the token's owner needs the Administer Jira global permission"

const PLANS = '/rest/api/3/plans/plan'

/** A Jira enum value (PascalCase) in pmkit's snake case: AnySprintDates is any_sprint_dates. */
const snake = (value) => (typeof value === 'string' ? value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() : null)
const isPremiumRefusal = (error) => error instanceof PmkitError && error.code === 'AUTH' && error.details?.jira?.status === 403 && !error.details.jira.captcha
const array = (value) => (Array.isArray(value) ? value : [])
const idOf = (value) => (value === undefined || value === null ? null : String(value))

const toSources = (sources) => array(sources).map((source) => ({ type: snake(source.type), id: source.value }))
const toScenario = (listed) => (listed?.scenarioId === undefined || listed?.scenarioId === null ? null : { id: String(listed.scenarioId), default: true })

function toListedPlan(plan) {
  return { id: idOf(plan.id), name: plan.name ?? null, status: snake(plan.status), scenario: toScenario(plan), sources: toSources(plan.issueSources) }
}

function toScheduling(scheduling) {
  if (!scheduling || typeof scheduling !== 'object') return null
  return {
    dependencies: snake(scheduling.dependencies),
    estimation: snake(scheduling.estimation),
    inferredDates: snake(scheduling.inferredDates),
    startDate: scheduling.startDate ?? null,
    endDate: scheduling.endDate ?? null,
  }
}

const PER = { scrum: 'per sprint', kanban: 'per week' }

/** The capacity unit Jira Plans states: the plan's estimation unit per sprint (Scrum) or per week (Kanban); null without scheduling. */
function capacityUnit(scheduling, planningStyle) {
  const unit = scheduling?.estimation?.replace(/_/g, ' ')
  const per = PER[planningStyle]
  return unit && per ? `${unit} ${per}` : null
}

function toTeam(listed, detail, scheduling) {
  const planningStyle = snake(detail.planningStyle)
  return {
    id: String(listed.id),
    type: snake(listed.type),
    name: detail.name ?? listed.name ?? null,
    planningStyle,
    sprintLength: detail.sprintLength ?? null,
    capacity: detail.capacity ?? null,
    capacityUnit: capacityUnit(scheduling, planningStyle),
    source: detail.issueSourceId ?? null,
    members: array(detail.memberAccountIds),
  }
}

export function planOperations({ client, site }) {
  const off = () => ({ available: false, reason: 'premium', enableHint: PLANS_HINT, site })

  async function readList({ archived = false, trashed = false, limit } = {}) {
    const query = { ...(archived ? { includeArchived: true } : {}), ...(trashed ? { includeTrashed: true } : {}) }
    return client.paginate(PLANS, { key: 'values', query, pageSize: 50, limit })
  }

  async function list(options = {}) {
    try {
      const { items, hasMore } = await readList(options)
      return { available: true, site, plans: items.map(toListedPlan), hasMore, warnings: [] }
    } catch (error) {
      if (isPremiumRefusal(error)) return { ...off(), plans: [], hasMore: false }
      throw error
    }
  }

  async function readTeam(planId, listed, scheduling, warnings) {
    const kind = listed.type === 'Atlassian' ? 'atlassian' : 'planonly'
    try {
      const detail = await client.request('GET', `${PLANS}/${planId}/team/${kind}/${encodeURIComponent(listed.id)}`)
      return toTeam(listed, detail ?? {}, scheduling)
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') {
        warnings.push(`team ${listed.id} is no longer in plan ${planId}, so it is left out`)
        return null
      }
      throw error
    }
  }

  async function get(id) {
    if (typeof id !== 'string' || !/^\d+$/.test(id)) {
      throw new PmkitError('INVALID_INPUT', `"${id}" is not a plan id`, 'Pass the plan id that jira plans list shows')
    }
    try {
      const plan = (await client.request('GET', `${PLANS}/${id}`)) ?? {}
      const teams = await client.paginate(`${PLANS}/${id}/team`, { key: 'values', pageSize: 50 })
      // getPlan has no scenarioId: the default scenario comes from the list, archived and trashed plans included.
      const all = (await readList({ archived: true, trashed: true })).items
      const listed = all.find((item) => String(item.id) === id)
      const scheduling = toScheduling(plan.scheduling)
      const warnings = teams.hasMore ? [`plan ${id} has more teams than pmkit read`] : []
      if (!listed) warnings.push(`the default scenario of plan ${id} was not found in the plan list (${all.length} plans read)`)
      const read = await Promise.all(teams.items.map((team) => readTeam(id, team, scheduling, warnings)))
      return {
        available: true,
        site,
        plan: {
          id,
          name: plan.name ?? null,
          status: snake(plan.status),
          lead: plan.leadAccountId ?? null,
          lastSaved: plan.lastSaved ?? null,
          sources: toSources(plan.issueSources),
          scenario: toScenario(listed),
          scheduling,
          releases: array(plan.crossProjectReleases).map((release) => ({ name: release.name ?? null, versionIds: array(release.releaseIds) })),
          teams: read.filter(Boolean),
        },
        warnings,
      }
    } catch (error) {
      if (isPremiumRefusal(error)) return off()
      throw error
    }
  }

  return { list, get }
}
