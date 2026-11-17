// The GitHub Issues adapter descriptor that ADAPTERS holds. It loads the tracker code only in create.
// See docs/specs/2026-11-16-pmk-86-github-discovery-and-setup-design.md, "The tracker".

import { builtInDefaults } from '../config.mjs'
import { parseProject, parseRepo } from './discovery.mjs'
import { HOST_NAME } from './client.mjs'
import { isIssueId } from './ids.mjs'
import { LABEL_PREFIX, NONE, parseFieldSource, parseLabelValue } from './mappings.mjs'

/** The GitHub rules on a .pmkit/config.yaml whose shape is valid. */
export function githubConfigProblems(pmkit) {
  const problems = []
  const scope = pmkit?.tracker?.scope ?? {}
  if (scope.host === undefined) problems.push('tracker.scope.host is required for github')
  else if (!HOST_NAME.test(scope.host)) problems.push('tracker.scope.host must be a host name, such as github.com')
  if (scope.repo === undefined) problems.push('tracker.scope.repo is required for github')
  else if (!parseRepo(scope.repo)) problems.push('tracker.scope.repo must be owner/name')
  if (scope.project !== undefined && parseProject(scope.project) === undefined) problems.push('tracker.scope.project must be owner/number or none')
  for (const [role, value] of Object.entries(pmkit?.mappings?.fields ?? {})) {
    if (!parseFieldSource(value)) problems.push(`mappings.fields.${role} must be issue:<name>, project:<name> or none for github`)
  }
  for (const group of ['status', 'types']) {
    for (const [key, value] of Object.entries(pmkit?.mappings?.[group] ?? {})) {
      if (typeof value === 'string' && value.startsWith(LABEL_PREFIX) && !parseLabelValue(value)) problems.push(`mappings.${group}.${key} must be label:<name> with a name`)
    }
  }
  for (const [type, value] of Object.entries(pmkit?.mappings?.types ?? {})) {
    if (value === NONE) problems.push(`mappings.types.${type} cannot be none; leave the type out instead`)
  }
  return problems
}

/** The GitHub descriptor. Tests pass a fake exec; ADAPTERS.github runs the real gh. */
export function githubDescriptor({ exec } = {}) {
  return {
    system: 'github',
    hosted: true,
    configProblems: githubConfigProblems,
    // An issue id is a number, #number or owner/name#number, so any other id goes to getDeliverable. GitHub names each issue's
    // linked branch, and creates it on origin, so issues branch checks that the start point has origin's commits.
    settings: () => ({ defaults: builtInDefaults(), epicPrefix: null, isEpicId: (id) => !isIssueId(id), trackerBranch: true, remoteBranch: true }),
    // The client and the runner that setup reads GitHub with before a config exists.
    connect: async ({ root, env, host }) => {
      const { createGithubClient } = await import('./client.mjs')
      const { defaultExec } = await import('./host.mjs')
      const run = exec ?? defaultExec({ root, env })
      return { client: createGithubClient({ root, env, host, exec: run }), exec: run }
    },
    create: async (config, { now, env }) => {
      const { createGithubTracker } = await import('./tracker.mjs')
      return createGithubTracker(config, { env, now, exec })
    },
  }
}
