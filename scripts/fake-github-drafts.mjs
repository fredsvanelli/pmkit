// The draft issues of the stateful fake GitHub (scripts/fake-github-issues.mjs): the Project, item and target reads and the
// conversion of scripts/lib/github/draft-issues.mjs, the extra Projects of --project, and seedDraft. A draft is an item with
// issueId null and a draft record; converting it creates the issue and points the same item at it, as GitHub does. A test may
// set item.type (PULL_REQUEST, REDACTED) to stand for an item the fake does not model.
// See docs/specs/2026-11-17-pmk-91-github-draft-issues-design.md.

/** Adds the draft keys to a state, new or loaded from an older toJSON(). extraProjects: [{ id, owner, number, title, linked }]. */
export function initDrafts(state, { extraProjects = [] } = {}) {
  state.extraProjects ??= extraProjects.map(({ id, owner, number, title, linked = true }) => ({ id, owner, number, title, linked }))
}

/**
 * The draft routes over a fake's state. helpers: stamp, register, requireRepository, repositoryById, newIssue, refuseWithData,
 * unknownNode, unprocessable, connection and userByLogin, as the fake defines them.
 */
export function draftRoutes(state, { stamp, register, requireRepository, repositoryById, newIssue, refuseWithData, unknownNode, unprocessable, connection, userByLogin }) {
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  const projects = () => [...(state.project ? [state.project] : []), ...state.extraProjects]
  const projectOf = (id) => projects().find((project) => project.id === id) ?? null
  const urlOf = (project) => `https://${state.host}/orgs/${project.owner}/projects/${project.number}`
  const login = (name) => (name === null ? null : { login: name })

  /** The field values of an item, as GitHub returns them: the Title first, then each set value of the Project's fields. */
  function fieldValues(item, title) {
    const project = projectOf(item.projectId)
    const nodes = [{ __typename: 'ProjectV2ItemFieldTextValue', text: title, field: { name: 'Title' } }]
    for (const field of project?.fields ?? []) {
      const value = item.values[field.id]
      if (!value) continue
      const ref = { name: field.name }
      if (field.dataType === 'SINGLE_SELECT') nodes.push({ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: field.options.find((option) => option.id === value.optionId)?.name ?? null, field: ref })
      else if (field.dataType === 'NUMBER') nodes.push({ __typename: 'ProjectV2ItemFieldNumberValue', number: value.number, field: ref })
      else if (field.dataType === 'DATE') nodes.push({ __typename: 'ProjectV2ItemFieldDateValue', date: value.date, field: ref })
    }
    return { nodes }
  }

  function itemView(item) {
    if (item.draft) {
      const draft = item.draft
      const content = {
        __typename: 'DraftIssue', title: draft.title, body: draft.body, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
        creator: login(draft.creator), assignees: { nodes: draft.assignees.map((name) => ({ login: name })) },
      }
      return { id: item.id, type: item.type ?? 'DRAFT_ISSUE', isArchived: item.isArchived, content, fieldValues: fieldValues(item, draft.title), project: { id: item.projectId } }
    }
    const issue = state.issues.find((record) => record.id === item.issueId)
    return { id: item.id, type: item.type ?? 'ISSUE', isArchived: item.isArchived, content: { __typename: 'Issue' }, fieldValues: fieldValues(item, issue?.title ?? ''), project: { id: item.projectId } }
  }

  const queries = {
    PmkitDraftProject({ owner, number }) {
      const project = projects().find((candidate) => sameName(candidate.owner, owner ?? '') && candidate.number === number)
      if (!project) refuseWithData({ repositoryOwner: { projectV2: null } }, ['repositoryOwner', 'projectV2'], `Could not resolve to a ProjectV2 with the number ${number}.`)
      return { repositoryOwner: { projectV2: { id: project.id, title: project.title, url: urlOf(project) } } }
    },
    PmkitDraftItems({ project, first, after }) {
      if (!projectOf(project)) unknownNode(project)
      const items = state.items.filter((item) => item.projectId === project).map(itemView)
      return { node: { items: connection(items, first, after) } }
    },
    PmkitDraftItem({ id }) {
      const item = state.items.find((candidate) => candidate.id === id) ?? unknownNode(id)
      return { node: itemView(item) }
    },
    PmkitDraftTarget(vars) {
      const entry = requireRepository(vars)
      return { repository: { id: entry.id, nameWithOwner: entry.nameWithOwner, hasIssuesEnabled: entry.hasIssuesEnabled !== false } }
    },
  }

  const mutations = {
    PmkitConvertDraftItem(input) {
      const item = state.items.find((candidate) => candidate.id === input.itemId) ?? unknownNode(input.itemId)
      if (!item.draft) unprocessable('The item is not a draft issue')
      const entry = repositoryById(input.repositoryId)
      if (entry.hasIssuesEnabled === false) unprocessable('Issues are disabled for this repository')
      const record = newIssue(entry, { title: item.draft.title, body: item.draft.body, author: state.viewer })
      record.assigneeIds = item.draft.assignees.map((name) => userByLogin(name)?.id).filter(Boolean)
      item.issueId = record.id
      delete item.draft
      const content = { __typename: 'Issue', id: record.id, number: record.number, url: `https://${state.host}/${record.repo}/issues/${record.number}`, repository: { nameWithOwner: record.repo } }
      return { convertProjectV2DraftIssueItemToIssue: { item: { id: item.id, content } } }
    },
  }

  /**
   * Adds a draft item. Fields: project (a Project id, the main Project by default), title, body, assignees (logins), creator
   * (a login, or null for a deleted account), archived, values ({ <Project field name>: option name, number or date }),
   * createdAt and updatedAt. Returns { item }.
   */
  function seedDraft({ project = state.project?.id, title = 'Seeded draft', body = '', assignees = [], creator = state.viewer, archived = false, values = {}, createdAt, updatedAt } = {}) {
    const found = projectOf(project)
    if (!found) throw new Error(`fake GitHub: seedDraft names an unknown Project ${project}`)
    const at = createdAt ?? stamp()
    state.counters.item += 1
    const item = { id: `PVTI_${state.counters.item}`, projectId: found.id, issueId: null, isArchived: archived, values: {}, draft: { title, body, assignees: [...assignees], creator, createdAt: at, updatedAt: updatedAt ?? at } }
    for (const [name, value] of Object.entries(values)) {
      const field = (found.fields ?? []).find((candidate) => candidate.name === name)
      if (!field) throw new Error(`fake GitHub: seedDraft names an unknown Project field ${name}`)
      if (field.dataType === 'SINGLE_SELECT') {
        const option = field.options.find((candidate) => candidate.name === value)
        if (!option) throw new Error(`fake GitHub: seedDraft names an unknown option ${value}`)
        item.values[field.id] = { optionId: option.id }
      } else item.values[field.id] = field.dataType === 'NUMBER' ? { number: value } : { date: value }
    }
    state.items.push(item)
    return { item: item.id }
  }

  /** Turns issues off or on in a repository, registered on first use. */
  function seedRepository(repo, { hasIssuesEnabled = true } = {}) {
    register(repo).hasIssuesEnabled = hasIssuesEnabled
  }

  /** The linked Projects of the scope repository, as PmkitLinkedProjects returns them. */
  const linked = () => projects().filter((project) => project === state.project || project.linked).map(({ number, title, owner }) => ({ number, title, owner }))

  return { queries, mutations, seedDraft, seedRepository, linked }
}
