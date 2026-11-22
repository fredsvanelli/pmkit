// The live probes of the Linear run (PMK-39): facts the PMK-35 to PMK-38 specs left open. Each probe is
// probe({ tracker, client, actor, team }) and returns { asserted, recorded }. It asserts only what pmkit relies on and
// records the rest, so the run's output grows the verification notes. `npm test` runs them over the fake only.
// The probes create at most 8 issues in all (1 + 1 + 2 + 3 + 1).

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { parseChange } from '../bulk.mjs'
import { CYCLES_QUERY, ISSUE_BY_ID_QUERY, ISSUE_HISTORY_QUERY } from './documents.mjs'
import { MILESTONE_CREATE } from './sandbox.mjs'

const CRITERIA = [{ text: 'first criterion', done: false }, { text: 'second criterion', done: true }]
const MARKER_COMMENT = ['<!-- pmkit:probe -->', '- [ ] a checklist item', '```', 'code fence', '```'].join('\n')

const rawIssue = async (client, id) => (await client.request(ISSUE_BY_ID_QUERY, { id })).issues.nodes[0]

/** The relation changes of an issue's history as { code, other } rows. */
async function relationChanges(client, id) {
  const { nodes } = await client.paginate(ISSUE_HISTORY_QUERY, { id }, { select: (data) => data.issue.history, pageSize: 100 })
  return nodes.flatMap((entry) => (entry.relationChanges ?? []).map((change) => ({ code: change.type, other: change.identifier })))
}

/** A description with an acceptance-criteria list round-trips through updateIssue and getIssue. */
export async function descriptionProbe({ tracker, client, actor }) {
  const created = (await tracker.createIssue({ title: 'Probe description', description: 'First paragraph.', acceptanceCriteria: CRITERIA }, actor)).after
  const description = 'Updated paragraph.\n\nSecond paragraph.'
  await tracker.updateIssue(created.id, { description, acceptanceCriteria: CRITERIA }, actor)
  const read = await tracker.getIssue(created.id)
  assert.equal(read.description, description)
  assert.deepEqual(read.acceptanceCriteria, CRITERIA)
  return {
    asserted: ['the parsed description and the criteria equal what updateIssue sent'],
    recorded: { rawDescription: (await rawIssue(client, created.id)).description },
  }
}

/** Which parts of a comment survive in its body, and whether a new comment moves updatedAt. */
export async function commentProbe({ tracker, actor }) {
  const { after: issue } = await tracker.createIssue({ title: 'Probe comment' }, actor)
  const before = (await tracker.getIssue(issue.id)).updated
  await tracker.comment(issue.id, MARKER_COMMENT, actor)
  const [comment] = await tracker.listComments(issue.id)
  const body = comment?.body ?? ''
  const moved = (await tracker.getIssue(issue.id)).updated !== before
  return {
    asserted: [],
    recorded: {
      markerLineSurvives: body.includes('<!-- pmkit:probe -->'),
      checklistSurvives: body.includes('- [ ] a checklist item'),
      codeFenceSurvives: body.includes('```\ncode fence\n```'),
      commentMovesUpdatedAt: moved,
    },
  }
}

/** The history codes and sides Linear gives a blocks relation, a duplicate relation and a removed one. */
export async function relationProbe({ tracker, client, actor }) {
  const a = (await tracker.createIssue({ title: 'Probe relation A' }, actor)).after.id
  const b = (await tracker.createIssue({ title: 'Probe relation B' }, actor)).after.id
  const seen = async () => ({ onA: await relationChanges(client, a), onB: await relationChanges(client, b) })
  const recorded = {}
  await tracker.link(a, b, 'blocks', actor)
  recorded.blocks = await seen()
  await tracker.unlink(a, b, 'blocks', actor)
  recorded.removed = await seen()
  await tracker.link(a, b, 'duplicate', actor)
  recorded.duplicate = await seen()
  return { asserted: [], recorded }
}

/** A cycle's endsAt is the next cycle's startsAt, and the time of day and the closed-cycle flags. */
export async function cycleProbe({ client, team }) {
  const { nodes } = await client.paginate(CYCLES_QUERY, { filter: { team: { key: { eq: team.key } } } }, { select: (data) => data.cycles, pageSize: 100 })
  nodes.sort((x, y) => x.number - y.number)
  for (let index = 1; index < nodes.length; index += 1) {
    if (nodes[index].number !== nodes[index - 1].number + 1) continue
    assert.equal(nodes[index - 1].endsAt, nodes[index].startsAt, `cycle ${nodes[index - 1].number} does not end where cycle ${nodes[index].number} starts`)
  }
  const past = nodes.filter((node) => node.isPast)
  return {
    asserted: ["a cycle's endsAt equals the next cycle's startsAt"],
    recorded: {
      cycles: nodes.length,
      timesOfDay: [...new Set(nodes.flatMap((node) => [node.startsAt, node.endsAt]).map((value) => value.slice(11)))],
      isPast: past.length,
      isPastWithCompletedAt: past.filter((node) => node.completedAt).length,
    },
  }
}

/**
 * PMK-255: the milestone writes of `issues create --parent <epic> --milestone`, `issues update --milestone` and `issues bulk milestone`
 * reach Linear through the guard. The adapter creates no milestone, so the run makes one in its own epic.
 */
export async function milestoneProbe({ tracker, client, actor }) {
  const epic = (await tracker.createDeliverable({ title: 'Probe milestone epic' }, actor)).after
  const updated = (await tracker.createIssue({ title: 'Probe milestone update', parent: epic.id }, actor)).after
  const projectId = (await rawIssue(client, updated.id)).project.id
  const milestone = randomUUID()
  await client.request(MILESTONE_CREATE, { input: { id: milestone, projectId, name: 'Probe milestone' } })
  const created = (await tracker.createIssue({ title: 'Probe milestone create', parent: epic.id, milestone }, actor)).after
  await tracker.updateIssue(updated.id, { milestone }, actor)
  const bulked = (await tracker.createIssue({ title: 'Probe milestone bulk', parent: epic.id }, actor)).after
  await parseChange('milestone', milestone).apply(tracker, bulked, actor)
  const milestoneOf = async (id) => (await tracker.getIssue(id)).milestone ?? null
  const recorded = { created: (await milestoneOf(created.id)) === milestone, updated: (await milestoneOf(updated.id)) === milestone, bulk: (await milestoneOf(bulked.id)) === milestone }
  await parseChange('milestone', 'none').apply(tracker, bulked, actor)
  recorded.cleared = (await milestoneOf(bulked.id)) === null
  for (const [key, value] of Object.entries(recorded)) assert.equal(value, true, `the milestone write "${key}" did not read back`)
  return {
    asserted: ['issueCreate under an epic with a milestone', 'issueUpdate with a milestone', 'the bulk milestone change', 'the bulk milestone change to none'],
    recorded,
  }
}

/** PMK-259: issues unarchive on Linear sends issueUnarchive for an archived issue, through the guard, and the issue is back. */
export async function unarchiveProbe({ tracker, actor }) {
  const { after: issue } = await tracker.createIssue({ title: 'Probe unarchive' }, actor)
  const archived = (await tracker.archive(issue.id, actor)).after.archived === true
  await tracker.unarchive(issue.id, actor)
  const back = (await tracker.searchIssues({})).issues.some((item) => item.id === issue.id && !item.archived)
  assert.equal(archived && back, true, 'the issue did not come back from the archive')
  return { asserted: ['archive then unarchive', 'the issue is listed again'], recorded: { archived, back } }
}

export const PROBES = [
  ['description round trip', descriptionProbe],
  ['comment body and updatedAt', commentProbe],
  ['relation history codes', relationProbe],
  ['cycle dates', cycleProbe],
  ['milestone writes', milestoneProbe],
  ['unarchive', unarchiveProbe],
]
