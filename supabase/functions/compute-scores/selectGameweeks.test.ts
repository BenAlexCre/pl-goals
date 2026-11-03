import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { needsScoring, selectGameweeksToScore, type ScoringSignals } from './selectGameweeks.ts'

const NOW = new Date('2026-11-02T12:00:00Z')
const FUTURE = '2026-11-07T14:45:00Z'
const PAST = '2026-11-01T14:45:00Z'
const none = (): ScoringSignals => ({ gameweeksWithActiveFixtures: new Set(), gameweeksWithLockedEntries: new Set() })

Deno.test('future deadline, no active fixtures, no locked entries -> skipped (all engines are no-ops)', () => {
  assertEquals(needsScoring({ id: 1, deadline_utc: FUTURE }, none(), NOW), false)
})

Deno.test('deadline passed -> scored (LMS missed-pick elimination runs after the deadline even before kickoff)', () => {
  assertEquals(needsScoring({ id: 1, deadline_utc: PAST }, none(), NOW), true)
})

Deno.test('deadline exactly now counts as passed -> scored', () => {
  assertEquals(needsScoring({ id: 1, deadline_utc: NOW.toISOString() }, none(), NOW), true)
})

Deno.test('unknown (null) deadline -> scored (conservative, never skipped)', () => {
  assertEquals(needsScoring({ id: 1, deadline_utc: null }, none(), NOW), true)
})

Deno.test('future deadline but a live/finished fixture -> scored (Predictor would act)', () => {
  const s = none(); s.gameweeksWithActiveFixtures.add(7)
  assertEquals(needsScoring({ id: 7, deadline_utc: FUTURE }, s, NOW), true)
})

Deno.test('future deadline but locked entries (e.g. deadline moved after locking) -> scored (Pick 5 would act)', () => {
  const s = none(); s.gameweeksWithLockedEntries.add(7)
  assertEquals(needsScoring({ id: 7, deadline_utc: FUTURE }, s, NOW), true)
})

Deno.test('signals for other gameweeks do not leak', () => {
  const s = none(); s.gameweeksWithActiveFixtures.add(8); s.gameweeksWithLockedEntries.add(9)
  assertEquals(needsScoring({ id: 7, deadline_utc: FUTURE }, s, NOW), false)
})

Deno.test('selectGameweeksToScore keeps order, reports skipped count', () => {
  const s = none(); s.gameweeksWithLockedEntries.add(3)
  const { toScore, skipped } = selectGameweeksToScore([
    { id: 1, deadline_utc: PAST },
    { id: 2, deadline_utc: FUTURE },
    { id: 3, deadline_utc: FUTURE },
    { id: 4, deadline_utc: null },
    { id: 5, deadline_utc: FUTURE },
  ], s, NOW)
  assertEquals(toScore.map((g) => g.id), [1, 3, 4])
  assertEquals(skipped, 2)
})
