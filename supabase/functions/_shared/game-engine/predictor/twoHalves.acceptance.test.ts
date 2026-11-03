// ACCEPTANCE TESTS — Score Predictor two-halves (40 / 40 / 20) prizes.
// Spec: docs/proposals/score-predictor-40-40-20.md (PENDING OWNER APPROVAL).
//
// These encode the specification's [RULE] items and its worked example as
// executable checks, but are SKIPPED: the calculation must not exist until the
// owner approves the rules (payout logic is deliberately unchanged). To enable:
// implement the two functions below, assign them, and the tests run.
// Owner decisions (1–8) are not encoded here — they change inputs/validation, not
// these formulas — except where a test is marked with its decision number.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

/** Which half a gameweek number belongs to (spec §3). */
type HalfOf = (gameweekNumber: number) => 1 | 2
/** Prize amounts per winner, in euros (spec §4). */
type SplitTwoHalves = (input: {
  netAtH1: number
  finalNet: number
  h1Winners: string[]
  h2Winners: string[]
  overallWinners: string[]
}) => { h1: Record<string, number>; h2: Record<string, number>; overall: Record<string, number>; unallocatedCents: number }

const halfOf: HalfOf | null = null
const splitTwoHalves: SplitTwoHalves | null = null
const pending = (fn: unknown) => fn === null

Deno.test({
  name: 'two-halves spec §3: GW1–19 are H1, GW20–38 are H2',
  ignore: pending(halfOf),
  fn() {
    for (const gw of [1, 10, 19]) assertEquals(halfOf!(gw), 1)
    for (const gw of [20, 30, 38]) assertEquals(halfOf!(gw), 2)
  },
})

Deno.test({
  name: 'two-halves spec §4: worked example — €180 net, tied H2 winners',
  ignore: pending(splitTwoHalves),
  fn() {
    const r = splitTwoHalves!({ netAtH1: 180, finalNet: 180, h1Winners: ['a'], h2Winners: ['b', 'c'], overallWinners: ['d'] })
    assertEquals(r.h1, { a: 72 })
    assertEquals(r.h2, { b: 36, c: 36 })
    assertEquals(r.overall, { d: 36 })
  },
})

Deno.test({
  name: 'two-halves spec §4: pool growth after H1 goes to H2 and Overall 2:1; H1 not clawed back',
  ignore: pending(splitTwoHalves),
  fn() {
    // H1 paid 40 % of €100 = €40. Final net €160 -> remaining €120 -> H2 €80, Overall €40.
    const r = splitTwoHalves!({ netAtH1: 100, finalNet: 160, h1Winners: ['a'], h2Winners: ['b'], overallWinners: ['c'] })
    assertEquals(r.h1, { a: 40 })
    assertEquals(r.h2, { b: 80 })
    assertEquals(r.overall, { c: 40 })
  },
})

Deno.test({
  name: 'two-halves spec §4: shares floored to the cent; leftover cents recorded, not paid',
  ignore: pending(splitTwoHalves),
  fn() {
    // H1 = 40 % of €10 = €4.00 split three ways -> €1.33 each, 1 cent unallocated.
    const r = splitTwoHalves!({ netAtH1: 10, finalNet: 10, h1Winners: ['a', 'b', 'c'], h2Winners: ['d'], overallWinners: ['e'] })
    assertEquals(r.h1, { a: 1.33, b: 1.33, c: 1.33 })
    assertEquals(r.unallocatedCents >= 1, true)
  },
})

Deno.test({
  name: 'two-halves spec §4: a prize with no eligible winner carries forward (H1 -> season-end remainder)',
  ignore: pending(splitTwoHalves),
  fn() {
    // No H1 winner: H1 pays €0, remaining = €180 -> H2 €120, Overall €60.
    const r = splitTwoHalves!({ netAtH1: 180, finalNet: 180, h1Winners: [], h2Winners: ['b'], overallWinners: ['c'] })
    assertEquals(r.h1, {})
    assertEquals(r.h2, { b: 120 })
    assertEquals(r.overall, { c: 60 })
  },
})

Deno.test({
  name: 'two-halves spec §2: one player can win more than one prize',
  ignore: pending(splitTwoHalves),
  fn() {
    const r = splitTwoHalves!({ netAtH1: 180, finalNet: 180, h1Winners: ['a'], h2Winners: ['b'], overallWinners: ['a'] })
    assertEquals(r.h1.a + r.overall.a, 108)
  },
})

Deno.test({
  name: 'two-halves spec §4: free pot — every prize is €0 but winners are still recorded',
  ignore: pending(splitTwoHalves),
  fn() {
    const r = splitTwoHalves!({ netAtH1: 0, finalNet: 0, h1Winners: ['a'], h2Winners: ['b'], overallWinners: ['c'] })
    assertEquals(r.h1, { a: 0 })
    assertEquals(r.h2, { b: 0 })
    assertEquals(r.overall, { c: 0 })
  },
})
