// The GitHub Issues tracker. discover reads the repository and its Project (PMK-86); capabilities says what pmkit serves.
// Every other contract operation is a stub until PMK-87.
// See docs/specs/2026-11-16-pmk-86-github-discovery-and-setup-design.md, "The tracker".

import { CAPABILITIES } from '../capabilities.mjs'
import { TRACKER_OPERATIONS } from '../contract.mjs'
import { PmkitError } from '../errors.mjs'
import { createGithubClient } from './client.mjs'
import { discoveryView, fetchDiscovery } from './discovery.mjs'
import { defaultExec } from './host.mjs'

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')
const ENABLE_GIT_HINT = 'Set git_host in .pmkit/config.yaml'

/** The manifest entries: linked_code follows the git host, as on Local; everything else waits for EPC-8. */
export function githubCapabilities(gitHost) {
  return CAPABILITIES.map((id) => {
    if (id === 'linked_code') return { id, path: 'derived', detail: { source: 'git' }, ...(gitHost === 'none' ? { enableHint: ENABLE_GIT_HINT } : {}) }
    return { id, path: 'absent', enableHint: `The GitHub adapter does not serve ${id} yet (EPC-8)` }
  })
}

export function createGithubTracker(config, { env, now = () => new Date(), exec } = {}) {
  const scope = config.pmkit?.tracker?.scope ?? {}
  const run = exec ?? defaultExec({ root: config.root, env })

  function requireScope() {
    for (const key of ['host', 'repo']) {
      if (typeof scope[key] !== 'string' || scope[key] === '') throw new PmkitError('NOT_CONFIGURED', `tracker.scope.${key} is not set in .pmkit/config.yaml`, '/pmkit:setup')
    }
  }

  async function discover() {
    requireScope()
    const client = createGithubClient({ root: config.root, env, host: scope.host, exec: run })
    const raw = await fetchDiscovery(client, { host: scope.host, repo: scope.repo, project: scope.project, exec: run })
    return discoveryView(raw, config.pmkit)
  }

  async function capabilities() {
    requireScope()
    const gitHost = config.pmkit?.git_host?.system ?? 'none'
    return {
      tracker: 'github',
      gitHost,
      generatedAt: isoSeconds(now()),
      host: scope.host,
      repo: scope.repo,
      project: scope.project ?? null,
      capabilities: githubCapabilities(gitHost),
      warnings: [],
    }
  }

  const stub = (operation) => async () => {
    throw new PmkitError('NOT_SUPPORTED', `the GitHub adapter does not implement ${operation} yet`, 'Set tracker.system to local in .pmkit/config.yaml to use this command now')
  }
  const implemented = { discover, capabilities }
  return Object.fromEntries(TRACKER_OPERATIONS.map((operation) => [operation, implemented[operation] ?? stub(operation)]))
}
