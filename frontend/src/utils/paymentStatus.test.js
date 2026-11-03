import { describe, it, expect } from 'vitest'
import { isFreeEntryFee, paymentState, PAYMENT_LABEL } from './paymentStatus'

describe('isFreeEntryFee (ISSUE-86)', () => {
  it('treats zero in any representation as free', () => {
    expect(isFreeEntryFee(0)).toBe(true)
    expect(isFreeEntryFee('0')).toBe(true)
    expect(isFreeEntryFee('0.00')).toBe(true)
  })
  it('never treats a fee, or an unknown fee, as free', () => {
    expect(isFreeEntryFee(5)).toBe(false)
    expect(isFreeEntryFee('20.00')).toBe(false)
    expect(isFreeEntryFee(null)).toBe(false)
    expect(isFreeEntryFee(undefined)).toBe(false)
    expect(isFreeEntryFee('')).toBe(false)
  })
})

describe('paymentState (ISSUE-86)', () => {
  it('a recorded payment is paid, in a free pot or not', () => {
    expect(paymentState({ isPaid: true, entryFee: 10 })).toBe('paid')
    expect(paymentState({ isPaid: true, entryFee: 0 })).toBe('paid')
  })
  it('an entry in a free pot is free — with no payment row, or with the default unpaid row', () => {
    expect(paymentState({ isPaid: null, entryFee: 0 })).toBe('free')
    expect(paymentState({ isPaid: undefined, entryFee: '0.00' })).toBe('free')
    expect(paymentState({ isPaid: false, entryFee: 0 })).toBe('free')
  })
  it('an unrecorded payment in a pot with a fee is unpaid', () => {
    expect(paymentState({ isPaid: false, entryFee: 10 })).toBe('unpaid')
    expect(paymentState({ isPaid: null, entryFee: '20.00' })).toBe('unpaid')
  })
  it('returns null when there is not enough information (no record, fee unknown)', () => {
    expect(paymentState({ isPaid: null, entryFee: undefined })).toBe(null)
  })
  it('has a label for every state', () => {
    expect(PAYMENT_LABEL).toEqual({ paid: 'Paid', free: 'Free entry', unpaid: 'Unpaid' })
  })
})
