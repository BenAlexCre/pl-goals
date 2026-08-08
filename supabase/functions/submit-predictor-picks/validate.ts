// Pure, side-effect-free request validation — same split as
// submit-pick5-picks/validate.ts and submit-lms-pick/validate.ts. Only
// checks request *shape*; business-rule validation (deadline, fixture
// membership, goalscorer eligibility) is PredictorEngine.validateEntry()'s
// job (GE-6). goalscorer_player_id is genuinely optional (decided
// 2026-08-06, Milestone 6 Slice 2 architecture review) — omitted or null
// are both valid, distinct from every other field here.

export interface SubmitPredictorPickRequestBody {
  game_entry_id?: unknown
  gameweek_id?: unknown
  fixture_id?: unknown
  predicted_home_score?: unknown
  predicted_away_score?: unknown
  goalscorer_player_id?: unknown
}

export type ValidationResult =
  | {
      ok: true
      gameEntryId: string
      gameweekId: number
      fixtureId: number
      predictedHomeScore: number
      predictedAwayScore: number
      goalscorerPlayerId: number | null
    }
  | { ok: false; error: string }

export function validateSubmitPredictorPickRequest(body: SubmitPredictorPickRequestBody): ValidationResult {
  if (typeof body.game_entry_id !== 'string' || body.game_entry_id.length === 0) {
    return { ok: false, error: 'game_entry_id is required' }
  }
  if (typeof body.gameweek_id !== 'number' || !Number.isInteger(body.gameweek_id)) {
    return { ok: false, error: 'gameweek_id must be an integer' }
  }
  if (typeof body.fixture_id !== 'number' || !Number.isInteger(body.fixture_id)) {
    return { ok: false, error: 'fixture_id must be an integer' }
  }
  if (typeof body.predicted_home_score !== 'number' || !Number.isInteger(body.predicted_home_score)) {
    return { ok: false, error: 'predicted_home_score must be an integer' }
  }
  if (typeof body.predicted_away_score !== 'number' || !Number.isInteger(body.predicted_away_score)) {
    return { ok: false, error: 'predicted_away_score must be an integer' }
  }

  let goalscorerPlayerId: number | null = null
  if (body.goalscorer_player_id !== undefined && body.goalscorer_player_id !== null) {
    if (typeof body.goalscorer_player_id !== 'number' || !Number.isInteger(body.goalscorer_player_id)) {
      return { ok: false, error: 'goalscorer_player_id must be an integer if provided' }
    }
    goalscorerPlayerId = body.goalscorer_player_id
  }

  return {
    ok: true,
    gameEntryId: body.game_entry_id,
    gameweekId: body.gameweek_id,
    fixtureId: body.fixture_id,
    predictedHomeScore: body.predicted_home_score,
    predictedAwayScore: body.predicted_away_score,
    goalscorerPlayerId,
  }
}
