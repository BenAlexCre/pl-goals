import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { checkEntryWindow, validateEntryRequest } from './validate.ts'

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

// ISSUE-32 / GE-5.2 entry-window rule.

Deno.test('checkEntryWindow: normal pot, now before start gameweek kickoff -> allowed', () => {
  const result = checkEntryWindow({
    rolloverSourcePotId: null,
    potStatus: 'active',
    startGameweekId: 13,
    startGameweekKickoffUtc: '2026-08-10T15:00:00Z',
    now: new Date('2026-08-01T00:00:00Z'),
  })
  assertEquals(result, { ok: true })
})

Deno.test('checkEntryWindow: normal pot, now after start gameweek kickoff -> rejected', () => {
  const result = checkEntryWindow({
    rolloverSourcePotId: null,
    potStatus: 'active',
    startGameweekId: 13,
    startGameweekKickoffUtc: '2026-08-10T15:00:00Z',
    now: new Date('2026-08-10T15:00:01Z'),
  })
  assertEquals(result.ok, false)
})

Deno.test('checkEntryWindow: normal pot, now exactly at kickoff -> rejected (boundary is exclusive)', () => {
  const result = checkEntryWindow({
    rolloverSourcePotId: null,
    potStatus: 'active',
    startGameweekId: 13,
    startGameweekKickoffUtc: '2026-08-10T15:00:00Z',
    now: new Date('2026-08-10T15:00:00Z'),
  })
  assertEquals(result.ok, false)
})

Deno.test('checkEntryWindow: normal pot with no start_gameweek_id configured -> rejected, not silently allowed', () => {
  const result = checkEntryWindow({
    rolloverSourcePotId: null,
    potStatus: 'active',
    startGameweekId: null,
    startGameweekKickoffUtc: null,
    now: new Date('2026-08-01T00:00:00Z'),
  })
  assertEquals(result.ok, false)
})

Deno.test('checkEntryWindow: rollover pot still in draft -> allowed, regardless of any gameweek timing', () => {
  const result = checkEntryWindow({
    rolloverSourcePotId: 'source-pot-id',
    potStatus: 'draft',
    startGameweekId: 20,
    startGameweekKickoffUtc: '2020-01-01T00:00:00Z', // deliberately in the past
    now: new Date('2026-08-01T00:00:00Z'),
  })
  assertEquals(result, { ok: true })
})

Deno.test('checkEntryWindow: rollover pot once activated (status no longer draft) -> rejected', () => {
  const result = checkEntryWindow({
    rolloverSourcePotId: 'source-pot-id',
    potStatus: 'active',
    startGameweekId: 20,
    startGameweekKickoffUtc: '2030-01-01T00:00:00Z', // deliberately in the future
    now: new Date('2026-08-01T00:00:00Z'),
  })
  assertEquals(result.ok, false)
})
