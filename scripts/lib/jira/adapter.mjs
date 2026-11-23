// The Jira adapter descriptor that ADAPTERS holds. It loads the tracker code only in create.
// See docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md, "Config" and "The tracker".

import { builtInDefaults } from '../config.mjs'
import { createJiraClient, HOST } from './client.mjs'

export const SPACE_KEY = /^[A-Z][A-Z0-9_]+$/

/** The Jira rules on a .pmkit/config.yaml whose shape is valid: a site host and a space key (ADR 0013). */
export function jiraConfigProblems(pmkit) {
  const { site, space } = pmkit?.tracker?.scope ?? {}
  const problems = []
  if (site === undefined) problems.push('tracker.scope.site is required for jira')
  else if (typeof site !== 'string' || !HOST.test(site.toLowerCase())) problems.push('tracker.scope.site must be a host such as acme.atlassian.net')
  if (space === undefined) problems.push('tracker.scope.space is required for jira')
  else if (typeof space !== 'string' || !SPACE_KEY.test(space)) problems.push('tracker.scope.space must be a space key such as ENG')
  return problems
}

/** The Jira descriptor. Tests pass a fake fetch; ADAPTERS.jira uses the global fetch at call time. */
export function jiraDescriptor({ fetch } = {}) {
  return {
    system: 'jira',
    hosted: true,
    configProblems: jiraConfigProblems,
    settings: () => ({ defaults: builtInDefaults(), epicPrefix: null }),
    // The client of one site, for setup to list the spaces before a space is chosen.
    connect: async ({ env, site }) => createJiraClient({ env, tracker: { scope: { site } }, fetch: fetch ?? globalThis.fetch }),
    create: async (config, { now, env }) => {
      const { createJiraTracker } = await import('./tracker.mjs')
      return createJiraTracker(config, { env, now, fetch: fetch ?? globalThis.fetch })
    },
  }
}
