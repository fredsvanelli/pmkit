// The issue operations of the GitHub adapter: the reads (getIssue, searchIssues, readNode) and the writes (createIssue,
// updateIssue with its linked branch, moveToCategory, assign, archive, delete).
// See docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md, "Ids", "The issue fragment", "Search", "Writes",
// "moveToCategory (criterion 2)", "assign, archive and delete" and "The issue's branch (decision 6)".

import { resolveDefaultBranch } from '../config.mjs'
import { REFERENCE_KINDS, REPO_UNCHECKED, referencedError } from '../delete-refusal.mjs'
import { PmkitError } from '../errors.mjs'
import { checkFilter, issueComparator } from '../issue-filter.mjs'
import { CATEGORIES } from '../model.mjs'
import { translateFilter } from './filter.mjs'
import { compareGithubIds, issueIdOf, notFound, parseIssueId } from './ids.mjs'
import { itemOf, toIssue, toIssueWithWarnings } from './issues.mjs'
import { docsOf, sender } from './requests.mjs'
import { planMove, planWrite, projectName, requireAssignable } from './writes.mjs'

const PAGE_SIZE = 100
// The nested connections of the issue fragment that may have more pages than the fragment reads.
const NESTED = ['labels', 'subIssues', 'blockedBy', 'blocking', 'relatesTo', 'projectItems']
/** The field variables a further page of a nested connection reads: all of them for projectItems, the Status for blockedBy. */
function moreVariables(field, context) {
  if (field === 'projectItems') return context.fieldVariables
  return field === 'blockedBy' && context.projectFields.status ? { fStatus: context.fieldVariables.fStatus } : {}
}
const NOTHING = () => ({ issues: [], problems: [], hasMore: false })

/**
 * The issue operations over a GitHub client. getContext({ refresh }) returns the context of makeContext; the tracker
 * passes one over its discovery memo, and refresh rereads GitHub. The writes read config.pmkit for pmkit's default branch.
 */
export function issueOperations({ client, config, getContext }) {
  /** Reads every page of each nested connection GitHub cut, so the node lists are complete before mapping. */
  async function completeNested(node, context) {
    const docs = docsOf(context)
    for (const field of NESTED) {
      if (node[field]?.pageInfo?.hasNextPage !== true) continue
      const variables = { id: node.id, ...moreVariables(field, context) }
      const { nodes } = await client.paginate(docs.MORE(field), variables, { select: (data) => data.node[field], pageSize: PAGE_SIZE })
      node[field] = { nodes, pageInfo: { hasNextPage: false } }
    }
    return node
  }

  /** The node and the issue of an id, in the scope repository or another one. A malformed id is NOT_FOUND with no request. */
  async function readNode(id) {
    const context = await getContext()
    const parsed = parseIssueId(id, context.repo)
    if (!parsed) throw notFound(id)
    const { repo, number } = parsed
    const [owner, name] = repo.split('/')
    let data
    try {
      data = await client.request(docsOf(context).ISSUE, { owner, name, number, ...context.fieldVariables })
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw notFound(id)
      throw error
    }
    const node = data?.repository?.issue
    if (!node) throw notFound(id)
    await completeNested(node, context)
    return { node, issue: toIssue(node, context) }
  }

  async function getIssue(id) {
    return (await readNode(id)).issue
  }

  /** Narrows on GitHub with filterBy, then runs the client steps, pmkit's order and the limit. */
  async function searchIssues(filter = {}) {
    const context = await getContext()
    const viewer = context.raw.viewer?.login ?? null
    const members = [...new Set([viewer, ...(context.raw.users ?? []).map((user) => user.login)].filter(Boolean))]
    // Any sprint passes the check here, so translateFilter answers NOT_SUPPORTED for it.
    checkFilter(filter, { types: Object.keys(context.pmkit?.mappings?.types ?? {}), members, sprintExists: () => true })
    const translated = translateFilter(filter, context, viewer)
    if (filter.limit === 0 || translated.empty) return NOTHING()
    const [owner, name] = context.repo.split('/')
    const variables = { owner, name, ...translated.variables, orderBy: { field: 'CREATED_AT', direction: 'ASC' }, ...context.fieldVariables }
    // GitHub's order (created, oldest first) is pmkit's order for the created sort, so that read stops once limit issues passed.
    const enough = translated.sort === 'created' && translated.limit !== undefined ? translated.limit : Infinity
    const kept = []
    const warnings = []
    let stopped = false
    const { hasMore } = await client.paginate(docsOf(context).ISSUES, variables, {
      select: (data) => data.repository.issues,
      pageSize: PAGE_SIZE,
      limit: translated.serverLimit,
      stop: async (nodes) => {
        for (const node of nodes) {
          await completeNested(node, context)
          const { issue, warnings: read } = toIssueWithWarnings(node, context)
          if (translated.clientSteps.every((step) => step(issue, node))) {
            kept.push(issue)
            warnings.push(...read)
          }
        }
        stopped = kept.length >= enough
        return stopped
      },
    })
    const issues = kept.sort(issueComparator(translated.sort, context.priorities))
    const cut = translated.limit === undefined ? issues : issues.slice(0, translated.limit)
    // hasMore means the page cap cut a read that still needed issues, never that the limit was reached.
    const shown = new Set(cut.map((issue) => `${issue.id} `))
    const shownWarnings = warnings.filter((warning) => shown.has(warning.slice(0, warning.indexOf(' ') + 1)))
    return { issues: cut, problems: [], hasMore: hasMore && !stopped, ...(shownWarnings.length > 0 ? { warnings: shownWarnings } : {}) }
  }

  // Writes.

  const invalid = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
  const CLOSE_WORDS = { COMPLETED: 'completed', NOT_PLANNED: 'not planned' }

  /** The viewer check: GitHub records every write as the gh login, so any other actor would make pmkit's output disagree with GitHub. */
  async function requireActor(actor) {
    const login = (await getContext()).raw.viewer?.login ?? null
    if (typeof actor !== 'string' || login === null || actor.toLowerCase() !== login.toLowerCase()) {
      throw invalid(`GitHub records every write as the gh login (${login})`, 'Drop --as, or log gh in as that user')
    }
  }

  /** The actor check and the scope repository check of a write on an existing issue, both before any read. Returns the context. */
  async function writable(id, actor) {
    await requireActor(actor)
    const context = await getContext()
    const parsed = parseIssueId(id, context.repo)
    if (parsed && parsed.repo !== context.repo) throw invalid(`the GitHub adapter writes issues of ${context.repo} only`)
    return context
  }

  /** Builds with the current context; when the build names something the discovery may not know yet, refreshes once and builds again. */
  async function withRefresh(build) {
    const context = await getContext()
    try {
      return { value: await build(context), context }
    } catch (error) {
      if (!(error instanceof PmkitError) || error.details?.stale !== true) throw error
      const fresh = await getContext({ refresh: true })
      return { value: await build(fresh), context: fresh }
    }
  }

  const send = sender(client)
  const afterOf = async (id) => (await readNode(id)).issue
  const withNotes = (result, notes) => (notes.length > 0 ? { ...result, notes } : result)

  /**
   * Runs steps of { done, doing, run } in order. A failure after a change exists throws UPSTREAM naming what changed and what did not;
   * `created` is the id of an issue this write just created, and the message then follows the spec's create wording.
   */
  async function runSteps(id, steps, { created = false } = {}) {
    const done = []
    for (const [index, step] of steps.entries()) {
      try {
        await step.run()
      } catch (error) {
        // After a create, any failure is wrapped, a TypeError from a broken payload too, so the user learns the issue exists.
        if (!created && (!(error instanceof PmkitError) || done.length === 0)) throw error
        const rest = steps.slice(index + 1).map((item) => item.doing)
        const head = created ? `created issue ${id}` : done.join(', then ')
        const tail = rest.length > 0 ? `. pmkit did not try ${rest.join(', ')}` : ''
        throw new PmkitError('UPSTREAM', `GitHub ${head}, but ${step.doing} failed: ${error.message}${tail}`, `pmkit issues get ${id}, then repeat the step that failed`, {
          done, failed: step.doing, notDone: rest, cause: error.code ?? error.name,
        })
      }
      done.push(step.done)
    }
  }

  /** The step of one move op. item holds the Project item id, which addItem sets. */
  function moveStep(op, id, nodeId, item, context) {
    if (op.op === 'addItem') return addItemStep(id, nodeId, item, context)
    if (op.op === 'setStatus') {
      const input = () => ({ projectId: context.project.id, itemId: item.id, fieldId: context.project.statusField.id, value: { singleSelectOptionId: op.option.id } })
      return { done: `set the Status of ${id} to ${op.option.name}`, doing: `setting its Status to ${op.option.name}`, run: () => send(context, 'SET_PROJECT_FIELD', input()) }
    }
    if (op.op === 'reopen') return { done: `reopened ${id}`, doing: 'reopening it', run: () => send(context, 'REOPEN_ISSUE', { issueId: nodeId }, true) }
    const words = CLOSE_WORDS[op.reason]
    return { done: `closed ${id} as ${words}`, doing: `closing it as ${words}`, run: () => send(context, 'CLOSE_ISSUE', { issueId: nodeId, stateReason: op.reason }, true) }
  }

  /** The step of one field write. A Project field needs the item, which an earlier step adds when the issue has none. */
  function fieldStep(write, id, nodeId, item, context) {
    const run = () => {
      if (write.source === 'issue') return send(context, 'SET_ISSUE_FIELD', { issueId: nodeId, issueFields: [write.write] })
      const target = { projectId: context.project.id, itemId: item.id, fieldId: write.fieldId }
      return write.write === null ? send(context, 'CLEAR_PROJECT_FIELD', target) : send(context, 'SET_PROJECT_FIELD', { ...target, value: write.write })
    }
    return { done: `wrote the ${write.role} of ${id}`, doing: `writing its ${write.role}`, run }
  }

  /** The step that adds the issue to the configured Project and keeps the new item's id in item. */
  function addItemStep(id, nodeId, item, context) {
    const project = projectName(context)
    return { done: `added ${id} to ${project}`, doing: `adding it to ${project}`, run: async () => { item.id = await addItem(nodeId, context) } }
  }

  async function addItem(nodeId, context) {
    return (await send(context, 'ADD_PROJECT_ITEM', { projectId: context.project.id, contentId: nodeId })).addProjectV2ItemById.item.id
  }

  /** The fragment node of a parent id on create. An id that is not an existing issue is INVALID_INPUT. */
  async function parentNodeOf(parent) {
    if (parent === undefined || parent === null) return null
    try {
      return (await readNode(parent)).node
    } catch (error) {
      if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw invalid(`parent ${parent} is not an existing issue or epic`, 'pmkit issues list')
      throw error
    }
  }

  async function createIssue(input, actor, { dryRun = false } = {}) {
    await requireActor(actor)
    const parentNode = await parentNodeOf(input?.parent)
    const { value: plan, context } = await withRefresh((current) => planWrite(input ?? {}, { mode: 'create', context: current, parentNode }))
    if (dryRun) return { before: null, after: plan.after }
    const node = (await send(context, 'CREATE_ISSUE', plan.input, true)).createIssue.issue
    const id = issueIdOf(node, context.repo)
    const item = { id: null }
    const steps = [
      ...(context.project ? [addItemStep(id, node.id, item, context)] : []),
      ...plan.fields.map((write) => fieldStep(write, id, node.id, item, context)),
      ...plan.move.map((op) => moveStep(op, id, node.id, item, context)),
    ]
    await runSteps(id, steps, { created: true })
    return { before: null, after: await afterOf(id) }
  }

  async function branchHead(branch, context) {
    const [owner, name] = context.repo.split('/')
    const data = await client.request(docsOf(context).BRANCH_HEAD, { owner, name, qualifiedName: `refs/heads/${branch}` })
    return { oid: data?.repository?.ref?.target?.oid ?? null, repositoryId: data?.repository?.id ?? context.raw.repositoryId }
  }

  /**
   * The linked branch an update creates: { name, start, oid, repositoryId, note }, start being the branch it starts at, or null when the issue has that branch already. It starts at
   * the GitHub head of base (pmkit's default branch when base is missing), never at GitHub's own default branch. A base GitHub lacks
   * falls back to pmkit's default branch with a note.
   */
  async function planBranch(name, before, base, context) {
    if (name === undefined || before.branch === name) return null
    if (before.branch !== undefined) throw invalid(`GitHub links ${before.id} to branch ${before.branch} already`, `Use the branch name ${before.branch}`)
    const fallback = resolveDefaultBranch(config?.pmkit).branch
    const start = (base ?? fallback).replace(/^origin\//, '')
    let head = await branchHead(start, context)
    let note = null
    let from = start
    if (head.oid === null && start !== fallback) {
      head = await branchHead(fallback, context)
      note = `GitHub has no branch ${start}, so pmkit linked ${name} at the head of ${fallback} there`
      from = fallback
    }
    if (head.oid === null) throw invalid(`GitHub has no branch ${fallback} to start ${name} from`, `Push ${fallback} to origin, or pass --from <a branch on GitHub>`)
    return { name, start: from, oid: head.oid, repositoryId: head.repositoryId, note }
  }

  /**
   * `base` is the branch the linked branch starts from, without origin/. A result that links a branch carries linked { branch, base },
   * base being the branch GitHub started it at: the fallback when GitHub lacks the one asked for.
   */
  async function updateIssue(id, patch, actor, { dryRun = false, base } = {}) {
    await writable(id, actor)
    const { node, issue: before } = await readNode(id)
    const { value: plan, context } = await withRefresh((current) => planWrite(patch ?? {}, { mode: 'update', before: node, context: current }))
    const branch = await planBranch(plan.branch, before, base, context)
    const notes = branch?.note ? [branch.note] : []
    const linked = branch ? { linked: { branch: branch.name, base: branch.start } } : {}
    const item = { id: itemOf(node, context)?.id ?? null }
    const steps = []
    if (Object.keys(plan.input).length > 0) steps.push({ done: `updated ${before.id}`, doing: 'updating it', run: () => send(context, 'UPDATE_ISSUE', { id: node.id, ...plan.input }, true) })
    if (item.id === null && plan.fields.some((write) => write.source === 'project')) {
      steps.push(addItemStep(before.id, node.id, item, context))
    }
    steps.push(...plan.fields.map((write) => fieldStep(write, before.id, node.id, item, context)))
    if (branch) {
      const input = { issueId: node.id, repositoryId: branch.repositoryId, name: branch.name, oid: branch.oid }
      steps.push({ done: `linked branch ${branch.name} to ${before.id}`, doing: `linking branch ${branch.name}`, run: () => send(context, 'CREATE_LINKED_BRANCH', input) })
    }
    if (steps.length === 0) return { before, after: before }
    if (dryRun) return withNotes({ before, after: plan.after, ...linked }, notes)
    await runSteps(before.id, steps)
    return withNotes({ before, after: await afterOf(before.id), ...linked }, notes)
  }

  async function moveToCategory(id, category, actor, { status, dryRun = false } = {}) {
    if (!CATEGORIES.includes(category)) throw invalid(`category must be one of ${CATEGORIES.join(', ')}`)
    const context = await writable(id, actor)
    const { node, issue: before } = await readNode(id)
    const move = planMove(node, category, { status }, context)
    if (move.steps.length === 0) return { before, after: before }
    if (dryRun) return { before, after: move.after }
    const item = { id: itemOf(node, context)?.id ?? null }
    await runSteps(before.id, move.steps.map((op) => moveStep(op, before.id, node.id, item, context)))
    return { before, after: await afterOf(before.id) }
  }

  /** `who` is a login, 'me' for the viewer, or null to unassign. GitHub's assignees are replaced by the one given. */
  async function assign(id, who, actor, { dryRun = false } = {}) {
    const context = await writable(id, actor)
    const login = who === 'me' ? context.raw.viewer.login : who
    const user = login === null ? null : (await withRefresh((current) => requireAssignable(current, login))).value
    const { node, issue: before } = await readNode(id)
    const current = node.assignees?.nodes ?? []
    const unchanged = user === null ? current.length === 0 : current.length === 1 && current[0].login.toLowerCase() === user.login.toLowerCase()
    if (unchanged) return { before, after: before }
    if (dryRun) return { before, after: toIssue({ ...node, assignees: { nodes: user ? [user] : [] } }, context) }
    await send(context, 'UPDATE_ISSUE', { id: node.id, assigneeIds: user ? [user.id] : [] }, true)
    return { before, after: await afterOf(before.id) }
  }

  async function archive(id, actor, { dryRun = false } = {}) {
    const context = await writable(id, actor)
    if (!context.project) throw new PmkitError('NOT_SUPPORTED', `tracker.scope.project is none, so pmkit has no Project to archive ${id} in`, 'Set tracker.scope.project with /pmkit:setup')
    const { node, issue: before } = await readNode(id)
    const item = itemOf(node, context)
    if (!item) throw invalid(`${before.id} is not in ${projectName(context)}`, `pmkit issues move ${before.id} <category> adds it`)
    if (item.isArchived) return { before, after: before }
    if (dryRun) return { before, after: { ...before, archived: true } }
    await send(context, 'ARCHIVE_ITEM', { projectId: context.project.id, itemId: item.id })
    return { before, after: await afterOf(before.id) }
  }

  /**
   * The issues that point at the issue: those it blocks, those related to it and its sub-issues. GitHub shows no list of the issues
   * marked as duplicates of it, so delete names that as unchecked.
   */
  function referencesTo(node, context) {
    const ids = (field) => (node[field]?.nodes ?? []).map((other) => issueIdOf(other, context.repo))
    const found = [
      ...ids('blocking').map((id) => ({ id, kind: 'blockedBy' })),
      ...ids('relatesTo').map((id) => ({ id, kind: 'related' })),
      ...ids('subIssues').map((id) => ({ id, kind: 'parent' })),
    ]
    const unique = [...new Map(found.map((ref) => [`${ref.id} ${ref.kind}`, ref])).values()]
    return unique.sort((a, b) => compareGithubIds(a.id, b.id) || REFERENCE_KINDS.indexOf(a.kind) - REFERENCE_KINDS.indexOf(b.kind))
  }

  /** Deletes an issue with deleteIssue. GitHub has no trash. It refuses, sending nothing, while another issue references it. */
  async function deleteIssue(id, actor, { dryRun = false } = {}) {
    const context = await writable(id, actor)
    const { node, issue: before } = await readNode(id)
    const references = referencesTo(node, context)
    if (references.length > 0) throw referencedError(before.id, references)
    const warnings = before.branch === undefined ? [] : [`branch ${before.branch} and its pull request stay as they are`]
    const result = {
      before, after: null, removes: { issue: true }, references: [], mentions: [], warnings,
      unchecked: ['issues marked as duplicates of it', 'the bodies and comments of other issues', REPO_UNCHECKED],
    }
    if (dryRun) return result
    await send(context, 'DELETE_ISSUE', { issueId: node.id })
    return result
  }

  return { getIssue, searchIssues, readNode, requireActor, createIssue, updateIssue, moveToCategory, assign, archive, delete: deleteIssue }
}
