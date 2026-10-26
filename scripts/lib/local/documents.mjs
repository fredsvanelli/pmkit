// Documents: plain files under <issuesDir>/docs/. Paths are relative to that folder.

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { writeFileAtomic } from './store.mjs'

const invalid = (message) => new PmkitError('INVALID_INPUT', message, 'Use a path relative to the docs folder, such as notes/plan.md')

/** The absolute file for a document path. Refuses absolute paths, `..` segments and anything that resolves outside the docs folder. */
export function resolveDocPath(docsDir, docPath) {
  if (typeof docPath !== 'string' || docPath.trim() === '') throw invalid('document path must be a non-empty string')
  const slashed = docPath.replaceAll('\\', '/')
  if (path.isAbsolute(docPath) || path.win32.isAbsolute(docPath) || slashed.startsWith('/')) throw invalid(`document path ${docPath} must be relative`)
  if (slashed.split('/').includes('..')) throw invalid(`document path ${docPath} must not contain ".."`)
  const file = path.resolve(docsDir, ...slashed.split('/'))
  const relative = path.relative(path.resolve(docsDir), file)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) throw invalid(`document path ${docPath} is outside the docs folder`)
  return file
}

const normalize = (text) => text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')

export function readDocumentFile(docsDir, docPath) {
  const file = resolveDocPath(docsDir, docPath)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new PmkitError('NOT_FOUND', `document ${docPath} does not exist`, 'Check the path under the docs folder')
  }
  return { path: docPath, body: normalize(fs.readFileSync(file, 'utf8')) }
}

/** Writes a new document. `onWrite(file)` gets the absolute file once it is written. */
export function createDocumentFile(docsDir, docPath, body, { dryRun = false, onWrite } = {}) {
  const file = resolveDocPath(docsDir, docPath)
  if (typeof body !== 'string' || body.trim() === '') throw invalid('document body must be a non-empty string')
  if (fs.existsSync(file)) throw new PmkitError('CONFLICT', `document ${docPath} already exists`, 'Pick another path')
  const text = normalize(body)
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeFileAtomic(file, text)
    onWrite?.(file)
  }
  return { before: null, after: { path: docPath, body: text } }
}
