// Pure, side-effect-free request validation — same split as
// get-or-create-pick5-entry/validate.ts, for the same reason (unit-testable
// without mocking HTTP or a Supabase client).
//
// This only checks request *shape* (5 integer player IDs). Business-rule
// validation (eligibility, goalkeeper exclusion, entry status) is
// Pick5Engine.validateEntry()'s job (GE-6) — deliberately not duplicated here.

export interface SubmitPicksRequestBody {
  game_entry_id?: unknown
  player_ids?: unknown
}

export type ValidationResult =
  | { ok: true; gameEntryId: string; playerIds: number[] }
  | { ok: false; error: string }

export function validateSubmitPicksRequest(body: SubmitPicksRequestBody): ValidationResult {
  if (typeof body.game_entry_id !== 'string' || body.game_entry_id.length === 0) {
    return { ok: false, error: 'game_entry_id is required' }
  }
  if (!Array.isArray(body.player_ids) || body.player_ids.length !== 5) {
    return { ok: false, error: 'player_ids must be an array of exactly 5 player IDs' }
  }
  const playerIds: number[] = []
  for (const id of body.player_ids) {
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      return { ok: false, error: 'player_ids must all be integers' }
    }
    playerIds.push(id)
  }
  return { ok: true, gameEntryId: body.game_entry_id, playerIds }
}
