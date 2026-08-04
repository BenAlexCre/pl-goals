import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateSubmitPicksRequest } from './validate.ts'

Deno.test('accepts a well-formed request', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1', player_ids: [1, 2, 3, 4, 5] })
  assertEquals(result, { ok: true, gameEntryId: 'entry-1', playerIds: [1, 2, 3, 4, 5] })
})

Deno.test('accepts duplicate player IDs (same player picked more than once)', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1', player_ids: [1, 1, 1, 1, 1] })
  assertEquals(result.ok, true)
})

Deno.test('rejects a missing game_entry_id', () => {
  const result = validateSubmitPicksRequest({ player_ids: [1, 2, 3, 4, 5] })
  assertEquals(result.ok, false)
})

Deno.test('rejects an empty-string game_entry_id', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: '', player_ids: [1, 2, 3, 4, 5] })
  assertEquals(result.ok, false)
})

Deno.test('rejects fewer than 5 player_ids', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1', player_ids: [1, 2, 3, 4] })
  assertEquals(result.ok, false)
})

Deno.test('rejects more than 5 player_ids', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1', player_ids: [1, 2, 3, 4, 5, 6] })
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing player_ids', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1' })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-array player_ids', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1', player_ids: 'not-an-array' })
  assertEquals(result.ok, false)
})

Deno.test('rejects a player_id sent as a numeric string', () => {
  const result = validateSubmitPicksRequest({
    game_entry_id: 'entry-1',
    player_ids: [1, 2, 3, 4, '5' as unknown as number],
  })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-integer player_id', () => {
  const result = validateSubmitPicksRequest({ game_entry_id: 'entry-1', player_ids: [1, 2, 3, 4, 5.5] })
  assertEquals(result.ok, false)
})
