// Side-effecting registration import (GE-7/GE-18) — same pattern as
// pick5/index.ts. Any Edge Function that needs LMS's engine imports this
// module, not engine.ts directly, so registerEngine() always runs before
// resolveEngine('last_man_standing') is called.
import { registerEngine } from '../dispatcher.ts'
import { LmsEngine } from './engine.ts'

registerEngine('last_man_standing', new LmsEngine())

export { LmsEngine } from './engine.ts'
export { LmsValidationError } from './errors.ts'
export type { LmsPickInput } from './engine.ts'
