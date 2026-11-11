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

/** PMK-250, PMK-256: `unarchive` works on the Local tracker only; the bulk command and the Linear tracker answer with this one error. */
export const unarchiveNotSupported = () => new PmkitError('NOT_SUPPORTED', 'unarchive works on the Local tracker only', "pmkit issues restore <id> brings a deleted issue back from Linear's trash")
