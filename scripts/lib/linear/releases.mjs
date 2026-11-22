// Linear releases as pmkit releases (PMK-246). The id is the release UUID, as milestones use theirs. A canceled release is
// outside pmkit: it is not listed, not read, and does not count as an issue's release.
// See docs/superpowers/specs/2026-11-10-pmk-246-linear-releases-design.md.

import { randomUUID } from 'node:crypto'
import { PmkitError } from '../errors.mjs'
import { compareReleaseIds } from '../local/releases.mjs'
import { isUnconfirmed } from './issue-ops.mjs'
import { RELEASES_QUERY, RELEASE_CREATE, RELEASE_QUERY, RELEASE_UPDATE, TEAM_RELEASE_PIPELINES_QUERY } from './documents.mjs'
import { RELEASES_HINT } from './manifest.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 100
const MAX_PAGES = 100

const canceled = (node) => node.stage?.type === 'canceled'

/** The release nodes that count: every one but a canceled release. The one place the canceled rule lives (PMK-266). */
export const activeReleases = (nodes) => nodes.filter((node) => !canceled(node))

/** The refusal of a release write or filter on a workspace with releases off. */
export const releasesOff = () => new PmkitError('NOT_SUPPORTED', 'Linear releases are off in this workspace', RELEASES_HINT)

/** The pmkit release of a Linear release node. */
export function toRelease(node) {
  const release = { id: node.id, name: node.name }
  if (node.targetDate) release.target = node.targetDate
  if (node.completedAt) release.released = node.completedAt
  release.state = node.completedAt ? 'released' : 'planned'
  release.description = node.description ?? ''
  return release
}

/** The release keys of an issue from its release nodes: `release` for one, `releases` for two or more, none for none. Canceled ones do not count. */
export function issueReleaseFields(nodes) {
  const ids = activeReleases(nodes).map((node) => node.id).sort()
  if (ids.length === 0) return {}
  return ids.length === 1 ? { release: ids[0] } : { releases: ids }
}

/** Every page of a release connection, or UPSTREAM when the page cap cut it, so a partial list never reads as the whole. */
export async function allReleases(client, document, variables, select) {
  const { nodes, hasMore } = await client.paginate(document, variables, { select, pageSize: PAGE, maxPages: MAX_PAGES })
  if (hasMore) throw new PmkitError('UPSTREAM', `Linear has more than ${PAGE * MAX_PAGES} releases here, and pmkit does not answer with part of them`, 'Archive old releases in Linear')
  return nodes
}

export function releaseOperations({ client, config, now = () => new Date(), uuid = randomUUID }) {
  const team = config.pmkit?.tracker?.scope?.team
  // Without a team the pipeline filter would be { eq: undefined }, which matches every team's releases (PMK-266).
  const requireTeam = () => {
    if (!team) throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.team is not set', '/pmkit:setup')
  }

  /** The raw release node of an id, or NOT_FOUND: unknown, malformed (no request) or canceled. */
  async function resolveRelease(id) {
    requireTeam()
    const missing = () => new PmkitError('NOT_FOUND', `release ${id} does not exist`, 'pmkit release list')
    if (typeof id !== 'string' || !UUID.test(id)) throw missing()
    let node
    try {
      node = (await client.request(RELEASE_QUERY, { id })).release
    } catch (error) {
      if (error instanceof PmkitError && /not found/i.test(error.message)) throw missing()
      throw error
    }
    if (!node) throw missing()
    if (canceled(node)) throw new PmkitError('NOT_FOUND', `release ${id} was canceled in Linear`, 'pmkit release list')
    // Refused like a milestone of another project: the same words for every issue, so a bulk change fails once.
    if (!(node.pipeline?.teams?.nodes ?? []).some((item) => item.key === team)) {
      throw new PmkitError('INVALID_INPUT', `release ${id} is not in a release pipeline of team ${team}`, 'Pick a release from pmkit release list')
    }
    return node
  }

  async function listReleases({ state } = {}) {
    requireTeam()
    if (state !== undefined && !['planned', 'released'].includes(state)) throw new PmkitError('INVALID_INPUT', 'state must be planned or released', 'pmkit release list')
    const filter = { pipeline: { teams: { some: { key: { eq: team } } } } }
    const nodes = await allReleases(client, RELEASES_QUERY, { filter }, (data) => data.releases)
    const key = (node) => node.version ?? node.name
    return activeReleases(nodes)
      .sort((a, b) => compareReleaseIds(key(a), key(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(toRelease)
      .filter((release) => state === undefined || release.state === state)
  }

  const noTag = (tag) => {
    if (typeof tag === 'string' && tag.trim() !== '') throw new PmkitError('INVALID_INPUT', 'Linear releases have no git tag', 'Drop --tag on Linear')
  }

  /** The scope team's release pipelines with their stages (PMK-261). */
  async function teamPipelines() {
    requireTeam()
    const data = await client.request(TEAM_RELEASE_PIPELINES_QUERY, { team })
    return data?.teams?.nodes?.[0]?.releasePipelines?.nodes ?? []
  }

  /** The one pipeline of the scope team a new release goes in. ponytail: several pipelines are refused; a --pipeline flag when a team needs it. */
  async function onePipeline() {
    const pipelines = await teamPipelines()
    if (pipelines.length === 0) throw new PmkitError('NOT_SUPPORTED', `team ${team} has no release pipeline`, 'Create a release pipeline for the team in Linear')
    if (pipelines.length > 1) throw new PmkitError('INVALID_INPUT', `team ${team} has ${pipelines.length} release pipelines (${pipelines.map((pipe) => pipe.name).join(', ')}), and pmkit creates a release only in a team with one`, 'Create the release in Linear')
    return pipelines[0]
  }

  /** release create on Linear (PMK-261): the pmkit id is the version, in the team's one pipeline. */
  async function createRelease(input, actor, { dryRun = false } = {}) {
    noTag(input.tag)
    const version = String(input.id ?? '').trim()
    if (version === '') throw new PmkitError('INVALID_INPUT', 'a release needs an id, its version on Linear', 'pmkit release create <version>')
    const pipeline = await onePipeline()
    const taken = (await allReleases(client, RELEASES_QUERY, { filter: { pipeline: { id: { eq: pipeline.id } } } }, (data) => data.releases)).find((node) => node.version === version && !canceled(node))
    if (taken) throw new PmkitError('CONFLICT', `release ${version} already exists in pipeline ${pipeline.name}`, `pmkit release get ${taken.id}`)
    const fields = { name: input.name ?? version, version, pipelineId: pipeline.id, ...(input.target ? { targetDate: input.target } : {}), ...(input.description ? { description: input.description } : {}) }
    if (dryRun) return { before: null, after: { id: null, ...toRelease({ ...fields, id: null, targetDate: fields.targetDate ?? null, completedAt: null, description: fields.description ?? '' }), id: null } }
    const id = uuid()
    let node
    try {
      node = (await client.request(RELEASE_CREATE, { input: { id, ...fields } }))?.releaseCreate?.release
    } catch (error) {
      if (!isUnconfirmed(error)) throw error
      // The UUID pmkit chose tells whether the create happened. One read, then the original error.
      node = (await client.request(RELEASE_QUERY, { id }).catch(() => null))?.release
      if (!node) throw error
    }
    return { before: null, after: toRelease(node) }
  }

  /** release mark-released on Linear (PMK-261): the release moves to its pipeline's completed stage, now. */
  async function markReleased(id, actor, { tag, dryRun = false } = {}) {
    noTag(tag)
    const node = await resolveRelease(id)
    const before = toRelease(node)
    if (before.released) throw new PmkitError('CONFLICT', `release ${before.id} was released at ${before.released}`, `pmkit release get ${before.id}`)
    const stage = (await teamPipelines()).find((pipe) => pipe.id === node.pipeline?.id)?.stages?.nodes?.find((item) => item.type === 'completed')
    if (!stage) throw new PmkitError('NOT_SUPPORTED', `the pipeline of release ${before.id} has no completed stage`, 'Add a completed stage to the pipeline in Linear')
    const completedAt = now().toISOString()
    if (dryRun) return { before, after: { ...before, released: completedAt, state: 'released' } }
    const answer = await client.request(RELEASE_UPDATE, { id: node.id, input: { stageId: stage.id, completedAt } })
    if (answer?.releaseUpdate?.success !== true) throw new PmkitError('UPSTREAM', `Linear did not mark release ${before.id} released`, `pmkit release get ${before.id}`)
    return { before, after: toRelease(answer.releaseUpdate.release) }
  }

  return { listReleases, getRelease: async (id) => toRelease(await resolveRelease(id)), resolveRelease, createRelease, markReleased }
}
