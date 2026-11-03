import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isFinanciallySettled, isFreeEntryFee, paymentState } from './paymentEligibility.ts'

Deno.test('isFreeEntryFee: zero in any representation is free', () => {
  assertEquals(isFreeEntryFee(0), true)
  assertEquals(isFreeEntryFee('0'), true)
  assertEquals(isFreeEntryFee('0.00'), true) // numeric(10,2) as a string
})

Deno.test('isFreeEntryFee: any positive fee, or an unknown fee, is NOT free', () => {
  assertEquals(isFreeEntryFee(5), false)
  assertEquals(isFreeEntryFee('20.00'), false)
  assertEquals(isFreeEntryFee(0.01), false)
  // Unknown is never assumed free — a missing fee must not exempt anyone from payment.
  assertEquals(isFreeEntryFee(null), false)
  assertEquals(isFreeEntryFee(undefined), false)
})

Deno.test('paymentState: paid / free / unpaid truth table', () => {
  assertEquals(paymentState({ isPaid: true, potIsFree: false }), 'paid')
  assertEquals(paymentState({ isPaid: false, potIsFree: false }), 'unpaid')
  assertEquals(paymentState({ isPaid: false, potIsFree: true }), 'free')
  // An explicit payment record in a free pot still reads as paid (it is a real record).
  assertEquals(paymentState({ isPaid: true, potIsFree: true }), 'paid')
})

Deno.test('isFinanciallySettled: only an unpaid entry in a pot with a fee is unsettled', () => {
  assertEquals(isFinanciallySettled({ isPaid: true, potIsFree: false }), true)
  assertEquals(isFinanciallySettled({ isPaid: false, potIsFree: true }), true)
  assertEquals(isFinanciallySettled({ isPaid: true, potIsFree: true }), true)
  assertEquals(isFinanciallySettled({ isPaid: false, potIsFree: false }), false)
})
