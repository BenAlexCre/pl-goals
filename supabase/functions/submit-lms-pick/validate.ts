// Pure, side-effect-free request validation — same split as
// submit-pick5-picks/validate.ts, for the same reason. Only checks request
// *shape*; business-rule validation (elimination status, team-has-a-fixture,
// no-repeat-team) is LmsEngine.validateEntry()'s job (GE-6).

export interface SubmitLmsPickRequestBody {
  game_entry_id?: unknown
  gameweek_id?: unknown
  team_id?: unknown
}

export type ValidationResult =
  | { ok: true; gameEntryId: string; gameweekId: number; teamId: number }
  | { ok: false; error: string }

export function validateSubmitLmsPickRequest(body: SubmitLmsPickRequestBody): ValidationResult {
  if (typeof body.game_entry_id !== 'string' || body.game_entry_id.length === 0) {
    return { ok: false, error: 'game_entry_id is required' }
  }
  if (typeof body.gameweek_id !== 'number' || !Number.isInteger(body.gameweek_id)) {
    return { ok: false, error: 'gameweek_id must be an integer' }
  }
  if (typeof body.team_id !== 'number' || !Number.isInteger(body.team_id)) {
    return { ok: false, error: 'team_id must be an integer' }
  }
  return { ok: true, gameEntryId: body.game_entry_id, gameweekId: body.gameweek_id, teamId: body.team_id }
}
