import { CheckCircle2, CreditCard } from 'lucide-react'
import { useMySeasonPayment } from '../../hooks/usePots'
import { isFreeEntryFee } from '../../utils/paymentStatus'

// ISSUE-44 — the player's own payment status on a season-scoped (Last Man
// Standing / Score Predictor) pot page. Pick 5 has its own per-gameweek
// equivalent in pick5/EntryStatusBar.jsx. Render only once the player has an
// entry: the payment row is created alongside the entry, and an unverified
// entry is voided at settlement (business-rules.md § Payment Verification),
// so "not verified yet" is the honest default rather than "unpaid".
export default function SeasonPaymentStatus({ potId, entryFee }) {
  const { data: payment, isLoading, isError } = useMySeasonPayment(potId)
  // ISSUE-86 — a free (€0) pot needs no payment; say so plainly.
  if (isFreeEntryFee(entryFee) && payment?.is_paid !== true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-white/60">
        <CheckCircle2 size={14} aria-hidden="true" />
        Free entry — no payment needed
      </span>
    )
  }
  if (isLoading || isError) return null

  if (payment?.is_paid) {
    return (
      <span className="inline-flex items-center gap-1.5 text-accent">
        <CheckCircle2 size={14} aria-hidden="true" />
        Entry paid
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-amber">
      <CreditCard size={14} aria-hidden="true" />
      Payment not verified yet — ask the organiser to record it
    </span>
  )
}
