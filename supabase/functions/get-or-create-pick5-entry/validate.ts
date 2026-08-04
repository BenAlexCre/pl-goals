// Pure, side-effect-free request validation — split out from index.ts so it's
// unit-testable without mocking HTTP or a Supabase client. Everything else in
// this function is I/O orchestration (auth lookup, DB reads/writes) verified
// via live integration testing instead — see validate.test.ts and
// session-log.md for what was actually exercised end to end.

export interface EntryRequestBody {
  pot_id?: unknown
  gameweek_id?: unknown
}

export type ValidationResult =
  | { ok: true; potId: string; gameweekId: number }
  | { ok: false; error: string }

export function validateEntryRequest(body: EntryRequestBody): ValidationResult {
  if (typeof body.pot_id !== 'string' || body.pot_id.length === 0) {
    return { ok: false, error: 'pot_id and gameweek_id are required' }
  }
  if (typeof body.gameweek_id !== 'number' || !Number.isInteger(body.gameweek_id)) {
    return { ok: false, error: 'pot_id and gameweek_id are required' }
  }
  return { ok: true, potId: body.pot_id, gameweekId: body.gameweek_id }
}
