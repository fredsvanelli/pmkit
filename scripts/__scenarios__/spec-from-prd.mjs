// /pmkit:spec:from-prd on the no-sprints fixture. The scenario records only the calls written in from-prd.md. The flow
// reaches other calls by following other command files, and their own scenarios cover those calls: an ADR follows
// spec/record-decision.md (Stage 3, and the ADR links of Stage 6), and the creates of the epic, the milestones and the
// issues follow spec/import.md (Stages 4 and 5). Neither entry reaches a write of those files.
//  .0 a new PRD, .issues/docs/specs/overview.md, for the existing epic EPC-4H7V. Stage 0 finds the dead-letter issue
//     ISS-9B2X, which is outside the epic, and the PM goes on. The PM approves the refined PRD in Stage 2, then declines
//     the ADR of its one `ADR` decision at the question of record-decision step 5, so nothing is written for it. Stage 3b
//     stores the refined PRD with that decision now `PRD only`. The PRD has no phases, so Stage 4 writes nothing and asks
//     nothing. In Stage 5 the epic already holds the signing and retry issues, and the PM stops at the tree to move
//     ISS-9B2X under the epic first. The flow stops and names /pmkit:spec:from-prd specs/webhook-platform-overview-prd.md.
//  .1 a resume from the stored refined PRD specs/webhook-replay-prd.md. Setup stands for the earlier run, which stored the
//     PRD, wrote ADR 0001 that cites it, created the epic Webhook replay with its two issues, and ended before Stage 6.
//     The resume finds the ADR, the PM confirms the epic, and Stage 5 has no new row, because the epic holds an issue for
//     each requirement. Stage 6 finds that the list blocks the replay, and the PM approves that link. The PM declines the
//     ADR links at the question of record-decision step 6, so nothing else is written.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const input = (name) => path.join(inputs, name)

const OVERVIEW_PRD = 'specs/webhook-platform-overview-prd.md'
const REPLAY_PRD = 'specs/webhook-replay-prd.md'
const REPLAY_ADR = 'adr/0001-replays-stay-manual-in-v1.md'

const NOT_A_RESUME = 'the PRD is new, not a refined PRD that an earlier run stored'
const STOPPED = 'the PM stops at the Stage 5 tree, so the flow ends before Stage 6'
const RESUMED = 'a resume skips Stages 1, 2 and 3b, because the refined PRD is already approved and stored'

const fresh = {
  command: 'spec/from-prd',
  fixture: 'no-sprints',
  prompt: '/pmkit:spec:from-prd .issues/docs/specs/overview.md EPC-4H7V',
  answers: ['Go on', 'Approve', 'No', 'Stop'],
  steps: [
    // Stage 0: the PRD, what exists, and the given epic.
    { step: '1', read: ['docs', 'read', 'specs/overview.md'], save: 'prd' },
    { step: '1', read: ['discover'] },
    { step: '1', read: ['epic', 'list'] },
    { step: '1', read: ['milestone', 'list'] },
    { step: '1', read: ['docs', 'list'] },
    { step: '1', read: ['issues', 'list', '--text', 'dead-letter'], save: 'deadLetter' },
    { step: '1', read: ['issues', 'list', '--text', 'backoff'] },
    { step: '1', read: ['issues', 'list', '--text', 'signed'] },
    { step: '1', read: ['epic', 'get', 'EPC-4H7V'], save: 'epic' },
    // The brief lists ISS-9B2X as a likely duplicate, and the PM goes on with EPC-4H7V.
    { confirm: 'Stage 0' },
    // Stage 2: the path is free, and the PM approves the draft and the path.
    { step: '4', dryRun: ['docs', 'create', OVERVIEW_PRD, '--body-file', input('from-prd-overview-prd.md')] },
    { confirm: 'Stage 2' },
    // Stage 3: the PM declines the ADR of the retry limit, so that decision becomes PRD only.
    { confirm: 'Stage 3' },
    // Stage 3b: the refined PRD with the changed mark.
    { step: '6', write: ['docs', 'create', OVERVIEW_PRD, '--body-file', input('from-prd-overview-prd-final.md')] },
    // Stage 5: done issues for the estimates, and the issues the epic already holds.
    { step: '8', read: ['issues', 'list', '--category', 'done', '--text', 'backoff'], save: 'doneBackoff' },
    { step: '8', read: ['issues', 'list', '--category', 'done', '--text', 'signature'], save: 'doneSignature' },
    { step: '8', read: ['issues', 'list', '--parent', 'EPC-4H7V'], save: 'held' },
    { confirm: 'Stage 5' },
  ],
  skip: {
    '2 docs list': NOT_A_RESUME,
    '2 docs read': NOT_A_RESUME,
    '9 issues get': STOPPED,
    '9 issues dependencies': STOPPED,
    '9 issues link': STOPPED,
    '9 docs adr-get': STOPPED,
  },
  notHit: {
    Resume: NOT_A_RESUME,
    'Stage 4': 'an epic ID is given and the PRD has no phases, so there is no new milestone and Stage 4 asks nothing',
    'Stage 6': STOPPED,
  },
  expect(repo, saved) {
    assert.match(saved.prd.body, /dead-letter queue/)
    assert.deepEqual(saved.deadLetter.issues.map((issue) => issue.id), ['ISS-9B2X'], 'the recon finds the likely duplicate')
    assert.equal(saved.epic.title, 'Reliable webhooks')
    assert.deepEqual(saved.doneBackoff.issues.map((issue) => [issue.id, issue.estimate]), [['ISS-6R3N', 8]])
    assert.deepEqual(saved.doneSignature.issues.map((issue) => [issue.id, issue.estimate]), [['ISS-2K5P', 5]])
    assert.deepEqual(saved.held.issues.map((issue) => issue.id).sort(), ['ISS-2K5P', 'ISS-6R3N'])
    const stored = repo.file(`.issues/docs/${OVERVIEW_PRD}`)
    assert.match(stored, /^- Deliveries are retried at most six times: PRD only\.$/m, 'the stored PRD carries the declined ADR as PRD only')
    assert.doesNotMatch(stored, /: ADR\.$/m)
    assert.equal(repo.file('.issues/docs/adr/0001-deliveries-are-retried-at-most-six-times.md'), null, 'no ADR is written')
    assert.equal(repo.issue('ISS-9B2X').parent, undefined, 'nothing moves ISS-9B2X')
  },
}

const epicId = (saved) => saved.epics.find((epic) => epic.title === 'Webhook replay').id
const issueId = (saved, title) => saved.tree.issues.find((issue) => issue.title === title).id
const blocks = (saved) => ['issues', 'link', issueId(saved, 'List parked deliveries'), issueId(saved, 'Replay a parked delivery'), '--kind', 'blocks']

const resume = {
  command: 'spec/from-prd',
  fixture: 'no-sprints',
  async setup({ root, pmkit }) {
    const docs = path.join(root, '.issues', 'docs')
    fs.writeFileSync(path.join(docs, REPLAY_PRD), fs.readFileSync(input('from-prd-replay-prd.md')))
    fs.mkdirSync(path.join(docs, 'adr'))
    fs.writeFileSync(path.join(docs, REPLAY_ADR), fs.readFileSync(input('from-prd-replay-adr.md')))
    const epic = (await pmkit(['epic', 'create', '--title-file', input('title-webhook-replay.md')])).after.id
    await pmkit(['issues', 'create', '--title-file', input('title-list-parked-deliveries.md'), '--type', 'feature', '--estimate', '3', '--parent', epic, '--criteria-file', input('from-prd-list-criteria.md')])
    await pmkit(['issues', 'create', '--title-file', input('title-replay-a-parked-delivery.md'), '--type', 'task', '--estimate', '2', '--parent', epic, '--criteria-file', input('from-prd-replay-criteria.md')])
  },
  prompt: `/pmkit:spec:from-prd ${REPLAY_PRD}`,
  answers: ['Yes', 'Yes', 'No'],
  steps: [
    // Stage 0: the stored refined PRD and what exists. A resume skips the duplicate question.
    { step: '1', read: ['docs', 'read', REPLAY_PRD], save: 'prd' },
    { step: '1', read: ['discover'] },
    { step: '1', read: ['epic', 'list'], save: 'epics' },
    { step: '1', read: ['milestone', 'list'] },
    { step: '1', read: ['docs', 'list'] },
    { step: '1', read: ['issues', 'list', '--text', 'replay'] },
    { step: '1', read: ['issues', 'list', '--text', 'parked'] },
    // Resume: the ADRs that cite the PRD path, then the epic whose title matches the PRD.
    { step: '2', read: ['docs', 'list'], save: 'docs' },
    { step: '2', read: ['docs', 'read', REPLAY_ADR], save: 'adr' },
    { confirm: 'Resume' },
    // Stage 5: done issues for the estimates, and the issues the epic already holds.
    { step: '8', read: ['issues', 'list', '--category', 'done', '--text', 'deliveries'], save: 'done' },
    { step: '8', read: (saved) => ['issues', 'list', '--parent', epicId(saved)], save: 'tree' },
    // Stage 6: the final check, the place of the ADR the resume found, and the missing blocker link.
    { step: '9', read: (saved) => ['issues', 'get', issueId(saved, 'List parked deliveries')] },
    { step: '9', read: (saved) => ['issues', 'get', issueId(saved, 'Replay a parked delivery')] },
    { step: '9', read: (saved) => ['issues', 'dependencies', epicId(saved)], save: 'before' },
    { step: '9', read: ['docs', 'adr-get', '1'], save: 'place' },
    { step: '9', dryRun: blocks },
    { confirm: 'Stage 6' },
    { step: '9', write: blocks },
  ],
  skip: {
    '1 epic get': 'no epic ID is given; the Resume step finds the epic by its title',
    '4 docs create': RESUMED,
    '6 docs create': RESUMED,
  },
  notHit: {
    'Stage 0': 'a resume skips the duplicate question, because the earlier run made the epic and the issues',
    'Stage 2': RESUMED,
    'Stage 3': 'the one decision marked ADR already has ADR 0001, so Stage 3 records nothing',
    'Stage 4': 'the PM confirms the epic of the earlier run, so Stage 4 is skipped',
    'Stage 5': 'the epic holds an issue for each requirement, so the tree has no new row',
  },
  expect(repo, saved) {
    assert.match(saved.prd.body, /^- Replays stay manual in v1: ADR\.$/m)
    assert.ok(saved.docs.some((doc) => doc.path === REPLAY_ADR), 'docs list holds the ADR')
    assert.ok(saved.adr.body.includes(REPLAY_PRD), 'the ADR cites the stored PRD path')
    assert.deepEqual(saved.done.issues.map((issue) => [issue.id, issue.estimate]), [['ISS-6R3N', 8]])
    assert.equal(saved.tree.issues.length, 2)
    // Before the link the epic has no blocker link, so the critical path falls back to the hierarchy.
    assert.equal(saved.before.basis, 'hierarchy')
    assert.ok(saved.before.nodes.every((node) => node.blockedBy.length === 0), 'the check finds no blocker link')
    assert.equal(saved.place.place, 'tracker')
    assert.equal(saved.place.path, `.issues/docs/${REPLAY_ADR}`)
    const list = issueId(saved, 'List parked deliveries')
    assert.deepEqual(repo.issue(issueId(saved, 'Replay a parked delivery')).blocked_by, [list])
    assert.equal(repo.newEvents(list).filter((event) => event.op === 'comment').length, 0, 'the PM declines the ADR links')
  },
}

export default [fresh, resume]
