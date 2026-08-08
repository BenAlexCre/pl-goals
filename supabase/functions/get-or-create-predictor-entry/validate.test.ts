import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateEntryRequest } from './validate.ts'

Deno.test('accepts a well-formed request', () => {
  const result = validateEntryRequest({ pot_id: 'abc-123' })
  assertEquals(result, { ok: true, potId: 'abc-123' })
})

Deno.test('rejects a missing pot_id', () => {
  const result = validateEntryRequest({})
  assertEquals(result.ok, false)
})

Deno.test('rejects an empty-string pot_id', () => {
  const result = validateEntryRequest({ pot_id: '' })
  assertEquals(result.ok, false)
})

Deno.test('rejects a non-string pot_id', () => {
  // A real, easy-to-make client bug, same category as
  // get-or-create-pick5-entry's "gameweek_id sent as a numeric string" case.
  const result = validateEntryRequest({ pot_id: 123 as unknown as string })
  assertEquals(result.ok, false)
})
