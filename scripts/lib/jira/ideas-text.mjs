// The plain text of the jira ideas commands (PMK-83). The agent writes summaries from --json.

export function listText(result) {
  if (!result.available) return `Jira Product Discovery is not available on ${result.site}: ${result.enableHint}`
  if (result.ideas.length === 0) return `no ideas in ${result.project.key} on ${result.site}`
  const votes = (idea) => idea.votes.map((vote) => `${idea.votes.length > 1 ? `${vote.field} ` : ''}${vote.value ?? 'unread'}`).join(', ') || 'unread'
  const lines = result.ideas.map((idea) => `${idea.id}  ${idea.title}  (${idea.status})  votes ${votes(idea)}  insights unread  delivery ${idea.epics.join(', ') || 'none'}`)
  return [...lines, ...(result.hasMore ? ['more ideas match; pass --limit to read more'] : [])].join('\n')
}

export function connectText(result, dryRun) {
  if (result.before.epics.includes(result.epic)) return `${result.idea} is already connected to ${result.epic}`
  return dryRun ? `would connect ${result.idea} to ${result.epic}\ndry run: nothing was written` : `connected ${result.idea} to ${result.epic}`
}
