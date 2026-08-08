// Unit tests for decideReinstatement() — the pure decision layer behind
// the Late Payment Override (reinstate_entry). handleReinstateEntry()'s
// own DB orchestration and Game Engine dispatch are not unit-tested here,
// same convention every other dispatcher-driving Edge Function in this
// codebase already follows (compute-scores/settle-gameweek/
// compute-deadlines have no .test.ts of their own) — that layer is
// live-verified instead.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { decideReinstatement, type ReinstatementEntryFacts } from './reinstate.ts'

function voidEntry(overrides: Partial<ReinstatementEntryFacts> = {}): ReinstatementEntryFacts {
  return { id: 'entry-1', status: 'void', gameweekId: null, reinstatedAt: null, ...overrides }
}

Deno.test('no entry found → no_entry', () => {
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry: null, isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'no_entry' })
})

Deno.test('an entry that is not void and has never been reinstated → not_void, rejected not silently no-opped', () => {
  const entry = voidEntry({ status: 'pending', reinstatedAt: null })
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry, isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'not_void' })
})

Deno.test('an unpaid void entry → payment_not_verified', () => {
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry: voidEntry(), isPaid: false, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'payment_not_verified' })
})

Deno.test('a paid void entry whose competition has already concluded → already_concluded', () => {
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry: voidEntry(), isPaid: true, isAlreadyConcluded: true })
  assertEquals(decision, { outcome: 'already_concluded' })
})

Deno.test('payment_not_verified takes priority over already_concluded when both are true', () => {
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry: voidEntry(), isPaid: false, isAlreadyConcluded: true })
  assertEquals(decision, { outcome: 'payment_not_verified' })
})

Deno.test('a paid, void, not-concluded LMS entry → reinstate to pending, writeStatus true', () => {
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry: voidEntry(), isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'reinstate', newStatus: 'pending', writeStatus: true })
})

Deno.test('a paid, void, not-concluded Score Predictor entry → reinstate to pending, writeStatus true', () => {
  const decision = decideReinstatement({ gameType: 'score_predictor', entry: voidEntry(), isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'reinstate', newStatus: 'pending', writeStatus: true })
})

Deno.test('a paid, void, not-concluded Pick 5 entry → reinstate to locked (not pending), matching its own calculateScore() filter', () => {
  const decision = decideReinstatement({
    gameType: 'pick5',
    entry: voidEntry({ gameweekId: 12 }),
    isPaid: true,
    isAlreadyConcluded: false,
  })
  assertEquals(decision, { outcome: 'reinstate', newStatus: 'locked', writeStatus: true })
})

Deno.test('retry: entry already non-void but previously reinstated → reinstate again, writeStatus false (status write skipped, recompute still runs)', () => {
  const entry = voidEntry({ status: 'pending', reinstatedAt: '2026-08-08T12:00:00.000Z' })
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry, isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'reinstate', newStatus: 'pending', writeStatus: false })
})

Deno.test('retry for Pick 5: entry already locked but previously reinstated → reinstate again, writeStatus false', () => {
  const entry = voidEntry({ status: 'locked', gameweekId: 12, reinstatedAt: '2026-08-08T12:00:00.000Z' })
  const decision = decideReinstatement({ gameType: 'pick5', entry, isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'reinstate', newStatus: 'locked', writeStatus: false })
})

Deno.test('a retried entry that is now unpaid again is still rejected, not blindly reinstated', () => {
  const entry = voidEntry({ status: 'pending', reinstatedAt: '2026-08-08T12:00:00.000Z' })
  const decision = decideReinstatement({ gameType: 'last_man_standing', entry, isPaid: false, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'payment_not_verified' })
})

Deno.test('an already-settled entry is left alone even if previously reinstated — not_void wins, no false reinstate', () => {
  const entry = voidEntry({ status: 'settled', reinstatedAt: null })
  const decision = decideReinstatement({ gameType: 'pick5', entry, isPaid: true, isAlreadyConcluded: false })
  assertEquals(decision, { outcome: 'not_void' })
})
