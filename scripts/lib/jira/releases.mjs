// Jira versions as pmkit releases (PMK-79). A release's id and name are the version's name. An archived version is outside
// pmkit: it is not listed, not read, and does not count as an issue's release.
// See docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md, "Releases".

import { PmkitError } from '../errors.mjs'
import { oneLine } from '../issue-fields.mjs'
import { compareReleaseIds } from '../local/releases.mjs'
import { TERMINAL, validDate } from '../model.mjs'
import { API } from './ids.mjs'

const PAGE = 50
const MAX_PAGES = 20
const STATES = ['planned', 'released']

const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
const notFound = (id) => new PmkitError('NOT_FOUND', `release ${id} does not exist`, 'pmkit release list')
const blank = (value) => value === undefined || value === null || value === ''

/** The pmkit release of a Jira version. A released version without a date has no `released` time: pmkit does not invent one. */
export function toRelease(version) {
  const release = { id: version.name, name: version.name }
  if (version.releaseDate) release.target = version.releaseDate
  if (version.released && version.releaseDate) release.released = `${version.releaseDate}T12:00:00Z`
  release.state = version.released ? 'released' : 'planned'
  release.description = version.description ?? ''
  return release
}

/** The versions that count: every one but an archived version. */
export const liveVersions = (versions) => versions.filter((version) => !version.archived)

/** The release keys of an issue from its fixVersions: `release` for one live version, `releases` for two or more, none for none. */
export function issueReleaseFields(fixVersions) {
  const names = liveVersions(fixVersions ?? []).map((version) => version.name).sort()
  if (names.length === 0) return {}
  return names.length === 1 ? { release: names[0] } : { releases: names }
}

/** Every version of a space, or UPSTREAM when the page cap cut the read, so a partial list never reads as the whole. */
export async function readVersions(client, spaceKey) {
  // ponytail: 20 pages of 50; raise the cap if a space ever holds more than 1000 versions.
  const { items, hasMore } = await client.paginate(`${API}/project/${encodeURIComponent(spaceKey)}/version`, { pageSize: PAGE, maxPages: MAX_PAGES })
  if (hasMore) throw new PmkitError('UPSTREAM', `Jira has more than ${PAGE * MAX_PAGES} versions in space ${spaceKey}, and pmkit does not answer with part of them`, 'Archive old versions in Jira')
  return items
}

const noTag = (tag) => {
  if (typeof tag === 'string' && tag.trim() !== '') throw invalid('Jira versions have no git tag', 'Drop --tag on Jira')
}

/**
 * The release operations over one client. `ops` is issueOperations(...), which supplies the actor check and the issue search.
 * getContext() is the tracker's. `now` is the clock; its UTC date is the date a version is released on.
 */
export function releaseOperations({ client, ops, getContext, now = () => new Date() }) {
  const today = () => now().toISOString().slice(0, 10)

  /** The live raw versions of the space. */
  const versions = async () => liveVersions(await readVersions(client, (await getContext()).space))

  async function findVersion(id) {
    const found = (await versions()).find((version) => version.name === id)
    if (!found) throw notFound(id)
    return found
  }

  async function listReleases({ state } = {}) {
    if (state !== undefined && !STATES.includes(state)) throw invalid('state must be planned or released', 'pmkit release list')
    return (await versions())
      .sort((a, b) => compareReleaseIds(a.name, b.name) || Number(a.id) - Number(b.id))
      .map(toRelease)
      .filter((release) => state === undefined || release.state === state)
  }

  const getRelease = async (id) => toRelease(await findVersion(id))

  /** The issues of a release. Jira has no archive, so `archived` changes nothing; a cut read refuses rather than answer with part of them. */
  async function releaseIssues(id) {
    await findVersion(id)
    const found = await ops.searchIssues({ release: id })
    if (found.hasMore) throw new PmkitError('UPSTREAM', `release ${id} has more issues than pmkit reads at once, and pmkit does not answer with part of them`, 'Narrow the search with pmkit issues list')
    return found.issues
  }

  async function createRelease(given, actor, { dryRun = false } = {}) {
    await ops.requireActor(actor)
    const input = given ?? {}
    noTag(input.tag)
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    if (id === '') throw invalid('a release needs an id, its version name on Jira', 'pmkit release create <version>')
    oneLine('id', id)
    if (!blank(input.name) && input.name !== id) throw invalid('a Jira version has one name, its id', 'Pass only the id, which becomes the name')
    if (!blank(input.target) && !validDate(input.target)) throw invalid('target must be a date as YYYY-MM-DD')
    if (!blank(input.description) && typeof input.description !== 'string') throw invalid('description must be a string')
    if ((await versions()).some((version) => version.name === id)) throw new PmkitError('CONFLICT', `release ${id} already exists`, `pmkit release get ${id}`)
    const context = await getContext()
    const body = { name: id, projectId: context.raw.space.id, ...(blank(input.description) ? {} : { description: input.description }), ...(blank(input.target) ? {} : { releaseDate: input.target }) }
    if (dryRun) return { before: null, after: toRelease({ ...body, released: false }) }
    return { before: null, after: toRelease(await client.request('POST', `${API}/version`, { body })) }
  }

  /** Marks a version released today (UTC), as Jira's Release button does, and lists the release's issues outside done and canceled. */
  async function markReleased(id, actor, { tag, dryRun = false } = {}) {
    await ops.requireActor(actor)
    noTag(tag)
    const version = await findVersion(id)
    const before = toRelease(version)
    if (version.released) throw new PmkitError('CONFLICT', `release ${id} is released already${before.released ? ` (${before.released})` : ''}`, `pmkit release get ${id}`)
    const unfinished = (await releaseIssues(id)).filter((issue) => !TERMINAL.includes(issue.status.category))
    const body = { released: true, releaseDate: today() }
    if (dryRun) return { before, after: toRelease({ ...version, ...body }), unfinished, problems: [] }
    const updated = await client.request('PUT', `${API}/version/${encodeURIComponent(version.id)}`, { body })
    return { before, after: toRelease(updated), unfinished, problems: [] }
  }

  return { listReleases, getRelease, createRelease, releaseIssues, markReleased, versions }
}
