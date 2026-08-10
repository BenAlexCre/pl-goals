import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateSeasonPayment } from './seasonPaymentValidation.ts'

Deno.test('validateSeasonPayment accepts an amount that exactly matches the entry fee', () => {
  assertEquals(validateSeasonPayment(25, 25), { outcome: 'valid' })
})

Deno.test('validateSeasonPayment rejects an amount below the entry fee', () => {
  const result = validateSeasonPayment(20, 25)
  assertEquals(result.outcome, 'invalid_amount')
  if (result.outcome === 'invalid_amount') {
    assertEquals(result.reason.includes('25.00'), true)
    assertEquals(result.reason.includes('single season payment'), true)
  }
})

Deno.test('validateSeasonPayment rejects an amount above the entry fee — no partial-prepay-for-many-weeks concept here', () => {
  const result = validateSeasonPayment(50, 25)
  assertEquals(result.outcome, 'invalid_amount')
})

Deno.test('validateSeasonPayment rejects when the pot has no entry fee configured', () => {
  const result = validateSeasonPayment(25, 0)
  assertEquals(result.outcome, 'invalid_amount')
  if (result.outcome === 'invalid_amount') {
    assertEquals(result.reason.includes('no entry fee configured'), true)
  }
})

Deno.test('validateSeasonPayment is exact under floating-point-risky inputs', () => {
  // 0.1 + 0.2 !== 0.3 in raw floating point — the whole reason this is
  // compared in integer cents, not a direct === on the raw numbers.
  assertEquals(validateSeasonPayment(0.3, 0.1 + 0.2), { outcome: 'valid' })
})
