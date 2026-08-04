import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateEntryRequest } from './validate.ts'

Deno.test('accepts a well-formed request', () => {
  const result = validateEntryRequest({ pot_id: 'abc-123', gameweek_id: 4 })
  assertEquals(result, { ok: true, potId: 'abc-123', gameweekId: 4 })
})

Deno.test('rejects a missing pot_id', () => {
  const result = validateEntryRequest({ gameweek_id: 4 })
  assertEquals(result.ok, false)
})

Deno.test('rejects an empty-string pot_id', () => {
  const result = validateEntryRequest({ pot_id: '', gameweek_id: 4 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a missing gameweek_id', () => {
  const result = validateEntryRequest({ pot_id: 'abc-123' })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-integer gameweek_id', () => {
  const result = validateEntryRequest({ pot_id: 'abc-123', gameweek_id: 4.5 })
  assertEquals(result.ok, false)
})

Deno.test('rejects a gameweek_id sent as a numeric string', () => {
  // A real, easy-to-make client bug — JSON.stringify never does this, but a
  // hand-built request body or a form field easily could.
  const result = validateEntryRequest({ pot_id: 'abc-123', gameweek_id: '4' as unknown as number })
  assertEquals(result.ok, false)
})
