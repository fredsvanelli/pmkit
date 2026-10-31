// Reads git remote URLs and picks the remote that says which git host a repository uses.
// Pure: the caller runs git and passes the remotes in.

const SCHEMES = ['http:', 'https:', 'ssh:', 'git:']
const SCP_FORM = /^(?:[^@\s/:]+@)?([a-z0-9][a-z0-9.-]*):(?!\/)(\S+)$/i

function fromPath(host, path) {
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const name = segments.pop().replace(/\.git$/i, '')
  if (name === '') return null
  return { host: host.toLowerCase(), owner: segments.join('/'), name }
}

/**
 * The host, owner and repository name of a remote URL, or null when the URL has none of them.
 * Reads https, http, ssh://, git:// and the scp form (git@host:owner/repo.git).
 */
export function parseRemoteUrl(url) {
  const text = typeof url === 'string' ? url.trim() : ''
  if (text === '') return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let parsed
    try {
      parsed = new URL(text)
    } catch {
      return null
    }
    if (!SCHEMES.includes(parsed.protocol) || parsed.hostname === '') return null
    return fromPath(parsed.hostname, decodeURIComponent(parsed.pathname))
  }
  const scp = SCP_FORM.exec(text)
  // A single letter before the colon is a Windows drive, not a host.
  if (!scp || scp[1].length < 2) return null
  return fromPath(scp[1], scp[2])
}

/**
 * What a remote URL says about the git host. github.com is `github` with the repo as owner/name, any other host is `none`,
 * and a URL that does not parse says nothing (`system: null`).
 */
export function inferHost(url) {
  const parsed = parseRemoteUrl(url)
  if (!parsed) return { system: null, repo: null, host: null }
  if (parsed.host === 'github.com' || parsed.host === 'www.github.com') {
    return { system: 'github', repo: `${parsed.owner}/${parsed.name}`, host: parsed.host }
  }
  return { system: 'none', repo: null, host: parsed.host }
}

/**
 * Picks the remote to read. remotes is [{ name, url }]. A wanted name must exist. Without one: origin, else the only remote,
 * else nothing, because several remotes without origin give no way to tell which one is the project's.
 * state is chosen, none, ambiguous or unknown-name.
 */
export function chooseRemote(remotes, wanted) {
  const names = remotes.map((remote) => remote.name)
  if (wanted !== undefined) {
    const found = remotes.find((remote) => remote.name === wanted)
    if (!found) return { remote: null, state: 'unknown-name', notes: [`there is no remote named ${wanted}; the remotes are ${names.join(', ') || 'none'}`] }
    return { remote: found, state: 'chosen', notes: [] }
  }
  if (remotes.length === 0) return { remote: null, state: 'none', notes: [] }
  const origin = remotes.find((remote) => remote.name === 'origin')
  if (origin) {
    const others = names.filter((name) => name !== 'origin')
    return { remote: origin, state: 'chosen', notes: others.length > 0 ? [`read origin and ignored the other remotes: ${others.join(', ')}`] : [] }
  }
  if (remotes.length === 1) {
    return { remote: remotes[0], state: 'chosen', notes: [`there is no origin, so ${remotes[0].name}, the only remote, was read`] }
  }
  return { remote: null, state: 'ambiguous', notes: [`there is no origin and there are several remotes (${names.join(', ')}); pass --remote <name> or --git-host`] }
}
