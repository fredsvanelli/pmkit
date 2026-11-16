export const ERROR_CODES = [
  'NOT_CONFIGURED',
  'NOT_FOUND',
  'NOT_SUPPORTED',
  'INVALID_INPUT',
  'CONFLICT',
  'AUTH',
  'RATE_LIMITED',
  'UPSTREAM',
]

export class PmkitError extends Error {
  constructor(code, message, nextStep, details) {
    if (!ERROR_CODES.includes(code)) throw new TypeError(`unknown error code "${code}"`)
    super(message)
    this.name = 'PmkitError'
    this.code = code
    this.nextStep = nextStep
    this.details = details
  }
}

export const isPmkitError = (error) => error instanceof PmkitError

/**
 * PMK-250, PMK-256: `unarchive` works on the Local tracker only; the bulk command and the hosted trackers answer with this one
 * error. The next step names what the tracker of `system` offers instead: Linear's trash, or the archived items of a GitHub Project.
 */
export const unarchiveNotSupported = (system = 'linear') =>
  new PmkitError(
    'NOT_SUPPORTED',
    'unarchive works on the Local tracker only',
    system === 'github' ? 'Restore the item from the archived items of the Project on GitHub' : "pmkit issues restore <id> brings a deleted issue back from Linear's trash",
  )
