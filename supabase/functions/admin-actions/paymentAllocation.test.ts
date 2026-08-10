import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { computePaymentAllocation } from './paymentAllocation.ts'

Deno.test('computePaymentAllocation accepts an exact multiple and allocates that many weeks', () => {
  const result = computePaymentAllocation({
    amount: 20,
    entryFee: 5,
    eligibleGameweekIds: [1, 2, 3, 4, 5, 6],
    alreadyPaidGameweekIds: new Set(),
  })

  assertEquals(result, { outcome: 'allocated', weeksRequested: 4, gameweekIds: [1, 2, 3, 4], skippedAlreadyPaidGameweekIds: [] })
})

Deno.test('computePaymentAllocation accepts the fee amount itself as a single week', () => {
  const result = computePaymentAllocation({ amount: 5, entryFee: 5, eligibleGameweekIds: [10], alreadyPaidGameweekIds: new Set() })
  assertEquals(result, { outcome: 'allocated', weeksRequested: 1, gameweekIds: [10], skippedAlreadyPaidGameweekIds: [] })
})

Deno.test('computePaymentAllocation rejects an amount that is not an exact multiple of the entry fee', () => {
  const result = computePaymentAllocation({ amount: 17, entryFee: 5, eligibleGameweekIds: [1, 2, 3, 4], alreadyPaidGameweekIds: new Set() })
  assertEquals(result.outcome, 'invalid_amount')
  if (result.outcome === 'invalid_amount') {
    assertEquals(result.reason.includes('exact multiple'), true)
    assertEquals(result.reason.includes('15.00'), true, 'suggests the nearest valid amount below')
    assertEquals(result.reason.includes('20.00'), true, 'suggests the nearest valid amount above')
  }
})

Deno.test('computePaymentAllocation rejects an amount smaller than the entry fee, suggesting only the amount above', () => {
  const result = computePaymentAllocation({ amount: 2, entryFee: 5, eligibleGameweekIds: [1], alreadyPaidGameweekIds: new Set() })
  assertEquals(result.outcome, 'invalid_amount')
  if (result.outcome === 'invalid_amount') {
    assertEquals(result.reason.includes('Try 5.00.'), true, 'no "0.00 or" suggestion when the amount is below one week')
  }
})

Deno.test('computePaymentAllocation is exact under floating-point-risky inputs (e.g. 0.1 + 0.2 style drift)', () => {
  // 4.35 / 0.05 in raw floating point is 86.99999999999999, not 87 — the
  // whole reason this is validated in integer cents, not raw division.
  const result = computePaymentAllocation({ amount: 4.35, entryFee: 0.05, eligibleGameweekIds: [1], alreadyPaidGameweekIds: new Set() })
  assertEquals(result.outcome, 'allocated')
  if (result.outcome === 'allocated') {
    assertEquals(result.weeksRequested, 87)
  }
})

Deno.test('computePaymentAllocation rejects when the pot has no entry fee configured', () => {
  const result = computePaymentAllocation({ amount: 20, entryFee: 0, eligibleGameweekIds: [1, 2], alreadyPaidGameweekIds: new Set() })
  assertEquals(result.outcome, 'invalid_amount')
  if (result.outcome === 'invalid_amount') {
    assertEquals(result.reason.includes('no entry fee configured'), true)
  }
})

Deno.test('computePaymentAllocation skips gameweeks already paid, extending coverage instead of re-confirming them', () => {
  const result = computePaymentAllocation({
    amount: 20,
    entryFee: 5,
    eligibleGameweekIds: [1, 2, 3, 4, 5, 6],
    alreadyPaidGameweekIds: new Set([1, 3]), // e.g. week 1 mark-paid individually, week 3 from an earlier payment
  })

  // 4 weeks requested; 1 and 3 are skipped, so the next 4 UNPAID weeks
  // (2, 4, 5, 6) are allocated — 4 weeks of genuinely NEW coverage, not
  // 2 new + 2 wasted re-confirming already-paid weeks.
  assertEquals(result, { outcome: 'allocated', weeksRequested: 4, gameweekIds: [2, 4, 5, 6], skippedAlreadyPaidGameweekIds: [1, 3] })
})

Deno.test('computePaymentAllocation materializes fewer weeks than requested when the season runs out of eligible gameweeks', () => {
  const result = computePaymentAllocation({
    amount: 50,
    entryFee: 5,
    eligibleGameweekIds: [1, 2, 3],
    alreadyPaidGameweekIds: new Set(),
  })

  assertEquals(result, { outcome: 'allocated', weeksRequested: 10, gameweekIds: [1, 2, 3], skippedAlreadyPaidGameweekIds: [] })
})

Deno.test('computePaymentAllocation returns zero allocated weeks when every eligible gameweek is already paid', () => {
  const result = computePaymentAllocation({
    amount: 15,
    entryFee: 5,
    eligibleGameweekIds: [1, 2, 3],
    alreadyPaidGameweekIds: new Set([1, 2, 3]),
  })

  assertEquals(result, { outcome: 'allocated', weeksRequested: 3, gameweekIds: [], skippedAlreadyPaidGameweekIds: [1, 2, 3] })
})

Deno.test('computePaymentAllocation only reports already-paid weeks actually skipped over, not the user\'s entire paid history', () => {
  // Week 1 is already paid but never even examined, since 2 unpaid weeks
  // are found (2, 3) before scanning would ever reach it — it must not
  // appear in skippedAlreadyPaidGameweekIds, since it was never "in the
  // way" of this particular allocation.
  const result = computePaymentAllocation({
    amount: 10,
    entryFee: 5,
    eligibleGameweekIds: [2, 3, 1],
    alreadyPaidGameweekIds: new Set([1]),
  })

  assertEquals(result, { outcome: 'allocated', weeksRequested: 2, gameweekIds: [2, 3], skippedAlreadyPaidGameweekIds: [] })
})

Deno.test('computePaymentAllocation is idempotent given the same inputs — same amount, same already-paid set, same result', () => {
  const input = { amount: 25, entryFee: 5, eligibleGameweekIds: [1, 2, 3, 4, 5], alreadyPaidGameweekIds: new Set([1]) }
  const first = computePaymentAllocation(input)
  const second = computePaymentAllocation(input)
  assertEquals(first, second)
})
