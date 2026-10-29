// The Local writer of an import: one file or config entry per record, with the dates and authors of the source.
// See the PMK-41 spec, "History on import" and "People". It never commits (plan, Decision 8).

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { addMapEntry, setScalar } from '../yaml-edit.mjs'
import { joinFrontmatter, parseYaml } from '../yaml.mjs'
import { epicFrontmatter, serializeEpic, serializeUpdate } from './epics.mjs'
import { appendEvents, driftEvents, readEvents } from './events.mjs'
import { serializeIssue, toFrontmatter } from './issue-file.mjs'
import { serializeSprint } from './sprints.mjs'
import { issuePaths, writeFileAtomic } from './store.mjs'

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

const COMMENT_ORDER = ['author', 'created', 'reply_to', 'resolved', 'resolved_by']

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, text)
}

/** True when some folder under `base` holds `<sub>/<stem>.md`. */
function findStem(base, sub, stem) {
  if (!fs.existsSync(base)) return false
  return fs.readdirSync(base, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, sub, `${stem}.md`)))
}

export function createLocalWriter({ root, config, actor, now = () => new Date() }) {
  const issuesDir = config.issuesDir ?? path.join(root, '.issues')
  const configFile = path.join(issuesDir, 'config.yaml')
  const stamp = () => isoSeconds(now())
  const readConfig = () => fs.readFileSync(configFile, 'utf8')
  const editConfig = (edit) => writeFileAtomic(configFile, edit(readConfig()))

  const creators = {
    member(id, fields) {
      const value = id.startsWith('agent:') || !fields.email ? { name: fields.name, availability: 1 } : { name: fields.name, email: fields.email, availability: 1 }
      editConfig((text) => addMapEntry(text, ['members'], id, value))
      return { id }
    },
    label(id, fields) {
      const name = fields.name ?? id
      editConfig((text) => {
        const current = parseYaml(text)?.labels ?? []
        return current.includes(name) ? text : setScalar(text, ['labels'], [...current, name])
      })
      return { id: name }
    },
    sprint(id, fields) {
      write(path.join(issuesDir, 'sprints', `${id}.yaml`), serializeSprint({ id, ...fields, extra: {} }))
      return { id }
    },
    epic(id, fields) {
      const epic = { id, title: fields.title, status: { name: fields.status }, start: fields.start ?? undefined, target: fields.target ?? undefined, description: fields.description ?? '' }
      const dir = path.join(issuesDir, 'epics', id)
      write(path.join(dir, 'epic.md'), serializeEpic(epic))
      appendEvents(path.join(dir, 'events.jsonl'), [{ at: fields.created ?? stamp(), by: actor, op: 'create', to: epicFrontmatter(epic) }])
      return { id }
    },
    update(id, fields) {
      const dir = path.join(issuesDir, 'epics', fields.epic, 'updates')
      let stem = id
      for (let n = 2; fs.existsSync(path.join(dir, `${stem}.md`)); n++) stem = `${id}-${n}`
      write(path.join(dir, `${stem}.md`), serializeUpdate(fields))
      return { id: stem }
    },
    issue(id, fields) {
      const issue = {
        id,
        title: fields.title,
        type: fields.type,
        status: { name: fields.status },
        priority: fields.priority,
        estimate: fields.estimate,
        assignee: fields.assignee,
        labels: fields.labels ?? [],
        parent: fields.parent,
        blockedBy: fields.blocked_by,
        related: fields.related,
        duplicateOf: fields.duplicate_of,
        sprint: fields.sprint,
        due: fields.due,
        archived: fields.archived,
        created: fields.created,
        description: fields.description ?? '',
        acceptanceCriteria: fields.acceptanceCriteria ?? [],
        body: '',
      }
      const files = issuePaths(issuesDir, id)
      write(files.file, serializeIssue(issue))
      // An unfinished earlier try may have left events; the replay starts over.
      if (fs.existsSync(files.events)) fs.rmSync(files.events)
      appendEvents(files.events, fields.events ?? [])
      const drift = driftEvents(toFrontmatter(issue), readEvents(files.events).events, { at: stamp(), by: actor })
      appendEvents(files.events, drift)
      return { id }
    },
    comment(id, fields) {
      const data = { author: fields.author, created: fields.created }
      if (fields.reply_to) data.reply_to = fields.reply_to
      if (fields.resolved) Object.assign(data, { resolved: stamp(), resolved_by: actor })
      write(path.join(issuePaths(issuesDir, fields.issue).comments, `${id}.md`), joinFrontmatter(data, `${String(fields.body).trim()}\n`, { order: COMMENT_ORDER }))
      return { id }
    },
  }

  const present = {
    member: (id) => Object.hasOwn(parseYaml(readConfig())?.members ?? {}, id),
    label: (id) => (parseYaml(readConfig())?.labels ?? []).includes(id),
    sprint: (id) => fs.existsSync(path.join(issuesDir, 'sprints', `${id}.yaml`)),
    epic: (id) => fs.existsSync(path.join(issuesDir, 'epics', id, 'epic.md')),
    update: (id) => findStem(path.join(issuesDir, 'epics'), 'updates', id),
    issue: (id) => fs.existsSync(issuePaths(issuesDir, id).file),
    comment: (id) => findStem(path.join(issuesDir, 'issues'), 'comments', id),
  }

  return {
    system: 'local',
    chooseId: (kind, record) => record.target,
    async create(kind, record, chosenId, fields) {
      const make = creators[kind]
      if (!make) throw new PmkitError('NOT_SUPPORTED', `the Local writer cannot create a ${kind}`)
      return make(chosenId, fields ?? record.fields)
    },
    async exists(kind, entries) {
      const found = new Map()
      for (const entry of entries) if (entry.uuid && present[kind]?.(entry.uuid)) found.set(entry.key, { id: entry.uuid })
      return found
    },
    async remove() {
      throw new PmkitError('NOT_SUPPORTED', 'an import is undone with git, not record by record', 'Run pmkit local-migrate undo to see the git commands')
    },
    budget: () => null,
    isUnconfirmed: () => false,
  }
}
