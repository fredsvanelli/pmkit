// File layout of a local tracker: issues/<ID>/{issue.md, events.jsonl, comments/<name>.md}.

import fs from 'node:fs'
import path from 'node:path'
import { compareIds, isId } from '../ids.mjs'

let counter = 0

export function issuePaths(issuesDir, id) {
  const dir = path.join(issuesDir, 'issues', id)
  return {
    dir,
    file: path.join(dir, 'issue.md'),
    events: path.join(dir, 'events.jsonl'),
    comments: path.join(dir, 'comments'),
  }
}

export function listIssueIds(issuesDir, prefix) {
  const dir = path.join(issuesDir, 'issues')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isId(entry.name, prefix))
    .map((entry) => entry.name)
    .sort(compareIds)
}

export function writeFileAtomic(file, text) {
  const temp = `${file}.tmp-${process.pid}-${counter++}`
  fs.writeFileSync(temp, text)
  fs.renameSync(temp, file)
}

export const fileMtimeIso = (file) => fs.statSync(file).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z')
