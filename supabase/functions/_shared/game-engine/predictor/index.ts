// Side-effecting registration import (GE-7/GE-18) — same pattern as
// pick5/index.ts and lms/index.ts. Any Edge Function that needs
// Predictor's engine imports this module, not engine.ts directly, so
// registerEngine() always runs before resolveEngine('score_predictor') is
// called.
import { registerEngine } from '../dispatcher.ts'
import { PredictorEngine } from './engine.ts'

registerEngine('score_predictor', new PredictorEngine())

export { PredictorEngine } from './engine.ts'
export { PredictorValidationError } from './errors.ts'
export type { PredictorPickInput } from './engine.ts'
