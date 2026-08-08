// Thrown by PredictorEngine.validateEntry() for any business-rule failure (as
// opposed to an unexpected database/infra error) — same split, same reason,
// as Pick5ValidationError/LmsValidationError.
export class PredictorValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PredictorValidationError'
  }
}
