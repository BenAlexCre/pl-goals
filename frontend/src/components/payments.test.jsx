import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EntryStatusBar from './pot/pick5/EntryStatusBar'
import PaymentTable from './admin/PaymentTable'
import SeasonPaymentStatus from './pot/SeasonPaymentStatus'

// ISSUE-86 regression tests: every payment surface distinguishes paid / free /
// unpaid, and a free pot never shows "Payment due" or offers "Mark paid".

let seasonPayment = { data: null, isLoading: false, isError: false }
vi.mock('../hooks/usePots', () => ({ useMySeasonPayment: () => seasonPayment }))
vi.mock('./ui/CountdownTimer', () => ({ default: () => null }))

describe('EntryStatusBar (Pick 5, player view)', () => {
  it('shows "Payment due" for an unpaid entry in a pot with a fee', () => {
    render(<EntryStatusBar isPaid={false} entryFee={5} hasEntry entryStatus="pending" />)
    expect(screen.getByText('Payment due')).toBeInTheDocument()
  })
  it('shows "Paid" for a recorded payment', () => {
    render(<EntryStatusBar isPaid entryFee={5} hasEntry entryStatus="pending" />)
    expect(screen.getByText('Paid')).toBeInTheDocument()
  })
  it('shows "Free entry", never "Payment due", in a free pot', () => {
    render(<EntryStatusBar isPaid={false} entryFee="0.00" hasEntry entryStatus="pending" />)
    expect(screen.getByText('Free entry')).toBeInTheDocument()
    expect(screen.queryByText('Payment due')).not.toBeInTheDocument()
  })
})

describe('PaymentTable (admin)', () => {
  const rows = [
    { user_id: 'u1', display_name: 'Alice', username: 'alice', is_paid: false, canReinstate: false },
    { user_id: 'u2', display_name: 'Bob', username: 'bob', is_paid: true, canReinstate: false },
  ]
  const handlers = { onMarkPaid: vi.fn(), onMarkUnpaid: vi.fn(), onReinstate: vi.fn() }

  it('pot with a fee: unpaid row offers Mark paid, paid row offers Mark unpaid', () => {
    render(<PaymentTable rows={rows} entryFee={10} weekly={false} {...handlers} />)
    expect(screen.getByText('Unpaid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark unpaid' })).toBeInTheDocument()
  })

  it('free pot: unmarked members read "Free entry" with no Mark paid button', () => {
    render(<PaymentTable rows={[rows[0]]} entryFee={0} weekly={false} {...handlers} />)
    expect(screen.getByText('Free entry')).toBeInTheDocument()
    expect(screen.getByText('No payment needed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark paid/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Unpaid')).not.toBeInTheDocument()
  })

  it('free pot: a void entry can still be offered for reinstatement', () => {
    render(<PaymentTable rows={[{ ...rows[0], canReinstate: true }]} entryFee={0} weekly={false} {...handlers} />)
    expect(screen.getByRole('button', { name: "Reinstate Alice's entry" })).toBeInTheDocument()
  })
})

describe('SeasonPaymentStatus (LMS / Score Predictor, player view)', () => {
  it('free pot: "Free entry — no payment needed"', () => {
    seasonPayment = { data: null, isLoading: false, isError: false }
    render(<SeasonPaymentStatus potId="p1" entryFee={0} />)
    expect(screen.getByText('Free entry — no payment needed')).toBeInTheDocument()
  })
  it('pot with a fee and no record: "Payment not verified yet"', () => {
    seasonPayment = { data: null, isLoading: false, isError: false }
    render(<SeasonPaymentStatus potId="p1" entryFee={10} />)
    expect(screen.getByText(/Payment not verified yet/)).toBeInTheDocument()
  })
  it('recorded payment: "Entry paid"', () => {
    seasonPayment = { data: { is_paid: true }, isLoading: false, isError: false }
    render(<SeasonPaymentStatus potId="p1" entryFee={10} />)
    expect(screen.getByText('Entry paid')).toBeInTheDocument()
  })
})
