import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateSubmitLmsPickRequest } from './validate.ts'

Deno.test('accepts a well-formed request', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: 'entry-1', gameweek_id: 13, team_id: 5 })
  assertEquals(result, { ok: true, gameEntryId: 'entry-1', gameweekId: 13, teamId: 5 })
})

Deno.test('rejects a missing game_entry_id', () => {
  const result = validateSubmitLmsPickRequest({ gameweek_id: 13, team_id: 5 })
  assertEquals(result.ok, false)
})

Deno.test('rejects an empty-string game_entry_id', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: '', gameweek_id: 13, team_id: 5 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing gameweek_id', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: 'entry-1', team_id: 5 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a gameweek_id sent as a numeric string', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: 'entry-1', gameweek_id: '13' as unknown as number, team_id: 5 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing team_id', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: 'entry-1', gameweek_id: 13 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a team_id sent as a numeric string', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: 'entry-1', gameweek_id: 13, team_id: '5' as unknown as number })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-integer team_id', () => {
  const result = validateSubmitLmsPickRequest({ game_entry_id: 'entry-1', gameweek_id: 13, team_id: 5.5 })
  assertEquals(result.ok, false)
})
