// The draft issues of the stateful fake GitHub (scripts/fake-github-issues.mjs): the Project, item and target reads and the
// conversion of scripts/lib/github/draft-issues.mjs, the extra Projects of --project, and seedDraft. A draft is an item of type
// DRAFT_ISSUE with issueId null and a draft record, in any Project of the fake; converting it creates the issue and turns the
// same item into an ISSUE item, as GitHub does. The item model and its content are the fake's (contentOf); seedProjectItem
// adds a pull request or a redacted item.
// See docs/specs/2026-11-17-pmk-91-github-draft-issues-design.md and docs/specs/2026-11-17-pmk-343-fake-github-project-items-design.md.

/** Adds the draft keys to a state, new or loaded from an older toJSON(). extraProjects: [{ id, owner, number, title, linked }]. */
export function initDrafts(state, { extraProjects = [] } = {}) {
  state.extraProjects ??= extraProjects.map(({ id, owner, number, title, linked = true }) => ({ id, owner, number, title, linked }))
}

/**
 * The draft routes over a fake's state. helpers: stamp, register, requireRepository, repositoryById, newIssue, refuseWithData,
 * unknownNode, unprocessable, connection, userByLogin, setItemValues, contentOf and projectValue, as the fake defines them.
 */
export function draftRoutes(state, { stamp, register, requireRepository, repositoryById, newIssue, refuseWithData, unknownNode, unprocessable, connection, userByLogin, setItemValues, contentOf, projectValue }) {
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  // Every Project of the fake: the scope Project, the epic Projects and the extra Projects of --project.
  const projects = () => [...(state.project ? [state.project] : []), ...state.projects, ...state.extraProjects]
  const projectOf = (id) => projects().find((project) => project.id === id) ?? null
  const urlOf = (project) => `https://${state.host}/orgs/${project.owner}/projects/${project.number}`

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
    const content = contentOf(item)
    return { id: item.id, type: item.type, isArchived: item.isArchived, content, fieldValues: fieldValues(item, content?.title ?? ''), project: { id: item.projectId } }
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
    // The reads of the live checks (scripts/lib/github/live-checks.mjs): the viewer, the viewer's Projects, a throwaway Project
    // and the iteration of each of its items.
    PmkitLiveViewer() {
      return { viewer: { login: state.viewer } }
    },
    PmkitLiveScope() {
      return { viewer: { projectsV2: { totalCount: projects().length } } }
    },
    PmkitLiveProject({ owner, number }) {
      const project = projects().find((candidate) => sameName(candidate.owner, owner ?? '') && candidate.number === number)
      if (!project) refuseWithData({ repositoryOwner: { projectV2: null } }, ['repositoryOwner', 'projectV2'], `Could not resolve to a ProjectV2 with the number ${number}.`)
      return { repositoryOwner: { projectV2: { id: project.id, title: project.title, items: { totalCount: state.items.filter((item) => item.projectId === project.id).length } } } }
    },
    PmkitLiveItems({ project, field, first, after }) {
      if (!projectOf(project)) unknownNode(project)
      const items = state.items.filter((item) => item.projectId === project).map((item) => ({ id: item.id, type: item.type, fieldValueByName: projectValue(item, field) }))
      return { node: { items: { totalCount: items.length, ...connection(items, first, after) } } }
    },
    PmkitLiveIssue(vars) {
      const entry = requireRepository(vars)
      const found = state.issues.find((issue) => sameName(issue.repo, entry.nameWithOwner) && issue.number === vars.number)
      return { repository: { issue: found ? { id: found.id } : null } }
    },
    PmkitDraftTarget(vars) {
      const entry = requireRepository(vars)
      return { repository: { id: entry.id, nameWithOwner: entry.nameWithOwner, hasIssuesEnabled: entry.hasIssuesEnabled !== false } }
    },
  }

  const mutations = {
    // addProjectV2DraftIssue, which only the live checks send.
    PmkitLiveAddDraft(input) {
      const found = projectOf(input.projectId) ?? unknownNode(input.projectId)
      if (typeof input.title !== 'string' || input.title.trim() === '') unprocessable('Title can\'t be blank')
      return { addProjectV2DraftIssue: { projectItem: { id: seedDraft({ project: found.id, title: input.title, body: input.body ?? '' }).item } } }
    },
    PmkitConvertDraftItem(input) {
      const item = state.items.find((candidate) => candidate.id === input.itemId) ?? unknownNode(input.itemId)
      if (item.type !== 'DRAFT_ISSUE') unprocessable('The item is not a draft issue')
      const entry = repositoryById(input.repositoryId)
      if (entry.hasIssuesEnabled === false) unprocessable('Issues are disabled for this repository')
      const record = newIssue(entry, { title: item.draft.title, body: item.draft.body, author: state.viewer })
      record.assigneeIds = item.draft.assignees.map((name) => userByLogin(name)?.id).filter(Boolean)
      item.type = 'ISSUE'
      item.issueId = record.id
      delete item.draft
      const content = { __typename: 'Issue', id: record.id, number: record.number, url: `https://${state.host}/${record.repo}/issues/${record.number}`, repository: { nameWithOwner: record.repo } }
      return { convertProjectV2DraftIssueItemToIssue: { item: { id: item.id, content } } }
    },
  }

  /**
   * Adds a draft item. Fields: project (the id of any Project of the fake, the main Project by default), title, body, assignees (logins), creator
   * (a login, or null for a deleted account), archived, values ({ <Project field name>: option name, number or date }),
   * createdAt and updatedAt. Returns { item }.
   */
  function seedDraft({ project = state.project?.id, title = 'Seeded draft', body = '', assignees = [], creator = state.viewer, archived = false, values = {}, createdAt, updatedAt } = {}) {
    const found = projectOf(project)
    if (!found) throw new Error(`fake GitHub: seedDraft names an unknown Project ${project}`)
    const at = createdAt ?? stamp()
    state.counters.item += 1
    const item = { id: `PVTI_${state.counters.item}`, projectId: found.id, type: 'DRAFT_ISSUE', issueId: null, isArchived: archived, values: {}, draft: { title, body, assignees: [...assignees], creator, createdAt: at, updatedAt: updatedAt ?? at } }
    setItemValues(item, found.fields ?? [], values)
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
