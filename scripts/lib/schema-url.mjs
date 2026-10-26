// The public URL of each config schema, built from the repository field of
// .claude-plugin/plugin.json so a fork points its users at its own schemas.

import fs from 'node:fs'

export const SCHEMA_FILES = { pmkit: 'pmkit.config.schema.json', issues: 'issues.config.schema.json' }

const MANIFEST = new URL('../../.claude-plugin/plugin.json', import.meta.url)

export function schemaUrl(file) {
  if (!Object.values(SCHEMA_FILES).includes(file)) throw new Error(`unknown schema file ${file}`)
  const { repository } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(String(repository ?? ''))
  if (!match) throw new Error(`the repository field of .claude-plugin/plugin.json must be a GitHub URL, got ${JSON.stringify(repository)}`)
  return `https://raw.githubusercontent.com/${match[1]}/main/schemas/${file}`
}
