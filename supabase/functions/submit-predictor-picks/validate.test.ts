import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateSubmitPredictorPickRequest } from './validate.ts'

function validBody() {
  return { game_entry_id: 'entry-1', gameweek_id: 13, fixture_id: 500, predicted_home_score: 2, predicted_away_score: 1 }
}

Deno.test('accepts a well-formed request with no goalscorer', () => {
  const result = validateSubmitPredictorPickRequest(validBody())
  assertEquals(result, {
    ok: true,
    gameEntryId: 'entry-1',
    gameweekId: 13,
    fixtureId: 500,
    predictedHomeScore: 2,
    predictedAwayScore: 1,
    goalscorerPlayerId: null,
  })
})

Deno.test('accepts a well-formed request with a goalscorer', () => {
  const result = validateSubmitPredictorPickRequest({ ...validBody(), goalscorer_player_id: 42 })
  assertEquals(result.ok, true)
  assertEquals((result as { goalscorerPlayerId: number | null }).goalscorerPlayerId, 42)
})

Deno.test('treats an explicit null goalscorer_player_id the same as omitting it', () => {
  const result = validateSubmitPredictorPickRequest({ ...validBody(), goalscorer_player_id: null })
  assertEquals(result.ok, true)
  assertEquals((result as { goalscorerPlayerId: number | null }).goalscorerPlayerId, null)
})

Deno.test('rejects a missing game_entry_id', () => {
  const { game_entry_id: _omit, ...rest } = validBody()
  const result = validateSubmitPredictorPickRequest(rest)
  assertEquals(result.ok, false)
})

Deno.test('rejects an empty-string game_entry_id', () => {
  const result = validateSubmitPredictorPickRequest({ ...validBody(), game_entry_id: '' })
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing gameweek_id', () => {
  const { gameweek_id: _omit, ...rest } = validBody()
  const result = validateSubmitPredictorPickRequest(rest)
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing fixture_id', () => {
  const { fixture_id: _omit, ...rest } = validBody()
  const result = validateSubmitPredictorPickRequest(rest)
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing predicted_home_score', () => {
  const { predicted_home_score: _omit, ...rest } = validBody()
  const result = validateSubmitPredictorPickRequest(rest)
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing predicted_away_score', () => {
  const { predicted_away_score: _omit, ...rest } = validBody()
  const result = validateSubmitPredictorPickRequest(rest)
  assertEquals(result.ok, false)
})

Deno.test('rejects predicted_home_score sent as a numeric string', () => {
  const result = validateSubmitPredictorPickRequest({ ...validBody(), predicted_home_score: '2' as unknown as number })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-integer predicted_away_score', () => {
  const result = validateSubmitPredictorPickRequest({ ...validBody(), predicted_away_score: 1.5 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-integer goalscorer_player_id when provided', () => {
  const result = validateSubmitPredictorPickRequest({ ...validBody(), goalscorer_player_id: 'nine' as unknown as number })
  assertEquals(result.ok, false)
})

// Deliberately no test for negative scores here — that's PredictorEngine.validateEntry()'s
// job (business-rule validation), same split submit-lms-pick/validate.ts
// documents; this layer only checks shape (is it an integer at all).
