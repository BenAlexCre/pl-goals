// Thrown by LmsEngine.validateEntry() for any business-rule failure (as
// opposed to an unexpected database/infra error) — same split, same reason,
// as Pick5ValidationError.
export class LmsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LmsValidationError'
  }
}
