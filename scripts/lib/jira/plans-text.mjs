// The plain text of the jira plans commands (PMK-82). The agent writes summaries from --json.

const off = (result) => `Jira Plans are not available on ${result.site}: ${result.enableHint}`

export function listText(result) {
  if (!result.available) return off(result)
  if (result.plans.length === 0) return `no plans on ${result.site}`
  const lines = result.plans.map((plan) => `${plan.id}  ${plan.name}  (${plan.status})  scenario ${plan.scenario?.id ?? 'none'}`)
  return [...lines, ...(result.hasMore ? ['more plans match; pass --limit to read more'] : [])].join('\n')
}

export function getText(result) {
  if (!result.available) return off(result)
  const { plan } = result
  const scenario = plan.scenario ? `${plan.scenario.id} (default; other scenarios are not readable through Jira's public API)` : 'not read'
  return [
    `${plan.id}  ${plan.name}  (${plan.status})`,
    ...(plan.scheduling ? [`dependencies: ${plan.scheduling.dependencies}`, `estimation: ${plan.scheduling.estimation}`] : []),
    `scenario: ${scenario}`,
    ...plan.releases.map((release) => `release: ${release.name}  versions ${release.versionIds.join(', ')}`),
    ...plan.teams.map((team) => `team: ${team.name ?? team.id}  ${team.planningStyle}  capacity ${team.capacity ?? 'unknown'}${team.capacityUnit ? ` ${team.capacityUnit}` : ''}`),
  ].join('\n')
}
