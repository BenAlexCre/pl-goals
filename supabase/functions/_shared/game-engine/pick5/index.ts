// Side-effecting registration import (GE-7/GE-18) — any Edge Function that
// needs Pick 5's engine imports this module (not engine.ts directly), so the
// registerEngine() call always runs before resolveEngine('pick5') is called.
import { registerEngine } from '../dispatcher.ts'
import { Pick5Engine } from './engine.ts'

registerEngine('pick5', new Pick5Engine())

export { Pick5Engine } from './engine.ts'
export { Pick5ValidationError } from './errors.ts'
export type { Pick5PickInput } from './engine.ts'
